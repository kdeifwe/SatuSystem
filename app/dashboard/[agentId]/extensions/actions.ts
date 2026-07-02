'use server';

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { registerTelegramNotificationsWebhook } from '@/lib/extensions/telegram-notify';
import { getDefaultConfig } from '@/lib/telegram-extension-config';

export type TelegramExtensionSettings = {
  recipients: string[];
  events: {
    operator_needed: { enabled: boolean };
    channel_down: { enabled: boolean };
    ai_silent: { enabled: boolean; threshold_minutes: number };
    deal_won: { enabled: boolean };
    deal_lost: { enabled: boolean };
    new_lead: { enabled: boolean };
    contact_received: { enabled: boolean };
    repeat_touches_exhausted: { enabled: boolean };
    lead_returned: { enabled: boolean; silence_days: number };
    scheduled_failed: { enabled: boolean };
    ai_error: { enabled: boolean };
    worker_down: { enabled: boolean };
    // Legacy events
    new_message?: { enabled: boolean; only_when_ai_paused: boolean };
    help_request?: { enabled: boolean };
    custom_conditions?: Array<{
      key: string;
      trigger: 'status_change';
      value: string;
      template: string;
    }>;
  };
};

export type TelegramMember = {
  id: string;
  full_name: string | null;
  telegram_chat_id: string | null;
  telegram_link_token: string | null;
  telegram_link_token_expires_at: string | null;
};

export type TelegramExtensionData = {
  active: boolean;
  members: TelegramMember[];
  recipients: string[];
  config: TelegramExtensionSettings;
  statuses: string[];
};

const defaultTelegramConfig = (): TelegramExtensionSettings => ({
  recipients: [],
  events: {
    operator_needed: { enabled: true },
    channel_down: { enabled: true },
    ai_silent: { enabled: true, threshold_minutes: 5 },
    deal_won: { enabled: true },
    deal_lost: { enabled: false },
    new_lead: { enabled: true },
    contact_received: { enabled: true },
    repeat_touches_exhausted: { enabled: true },
    lead_returned: { enabled: true, silence_days: 7 },
    scheduled_failed: { enabled: true },
    ai_error: { enabled: true },
    worker_down: { enabled: true },
    custom_conditions: [],
  },
});

export async function getTelegramExtensionData(agentId: string): Promise<TelegramExtensionData> {
  const admin = createAdminClient();

  const { data: agent } = await admin.from('agents').select('org_id').eq('id', agentId).single();
  if (!agent?.org_id) {
    return {
      active: false,
      members: [],
      recipients: [],
      config: defaultTelegramConfig(),
      statuses: [],
    };
  }

  const { data: memberships } = await admin
    .from('org_members')
    .select('user_id')
    .eq('org_id', agent.org_id);

  const profileIds = (memberships ?? [])
    .map((membership) => membership.user_id)
    .filter((value): value is string => Boolean(value));

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name, telegram_chat_id, telegram_link_token, telegram_link_token_expires_at')
    .in('id', profileIds);

  const { data: settingsRow } = await admin
    .from('extension_settings')
    .select('is_active, config')
    .eq('agent_id', agentId)
    .eq('extension_type', 'telegram_notifications')
    .maybeSingle();

  const { data: leads } = await admin
    .from('leads')
    .select('status')
    .eq('agent_id', agentId)
    .not('status', 'is', null);

  const statuses = Array.from(
    new Set((leads ?? []).map((lead) => lead.status).filter((value): value is string => Boolean(value)))
  ).sort();

  const config = ((settingsRow?.config as TelegramExtensionSettings | undefined) ?? defaultTelegramConfig()) as TelegramExtensionSettings;
  const recipients = Array.isArray(config?.recipients) ? config.recipients : [];

  return {
    active: Boolean(settingsRow?.is_active),
    members: (profiles ?? []).map((profile) => ({
      id: profile.id,
      full_name: profile.full_name,
      telegram_chat_id: profile.telegram_chat_id,
      telegram_link_token: profile.telegram_link_token,
      telegram_link_token_expires_at: profile.telegram_link_token_expires_at,
    })),
    recipients,
    config: getDefaultConfig({
      recipients,
      events: {
        ...(config?.events ?? {}),
        new_message: {
          enabled: config?.events?.new_message?.enabled ?? true,
          only_when_ai_paused: config?.events?.new_message?.only_when_ai_paused ?? false,
        },
        help_request: {
          enabled: config?.events?.help_request?.enabled ?? true,
        },
        custom_conditions: Array.isArray(config?.events?.custom_conditions)
          ? config.events.custom_conditions
          : [],
      },
    }),
    statuses,
  };
}

export async function generateTelegramLinkToken(profileId: string) {
  if (!profileId) {
    return { error: 'Профиль не найден' };
  }

  const admin = createAdminClient();
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { error } = await admin
    .from('profiles')
    .update({
      telegram_link_token: token,
      telegram_link_token_expires_at: expiresAt,
    })
    .eq('id', profileId);

  if (error) {
    return { error: 'Не удалось создать ссылку' };
  }

  const botUsername = process.env.TELEGRAM_NOTIFICATIONS_BOT_USERNAME ?? 'your_notification_bot';
  return {
    success: true,
    link: `https://t.me/${botUsername}?start=${token}`,
    expiresAt,
  };
}

export async function disconnectTelegramProfile(profileId: string) {
  if (!profileId) {
    return { error: 'Профиль не найден' };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('profiles')
    .update({ telegram_chat_id: null })
    .eq('id', profileId);

  if (error) {
    return { error: 'Не удалось отключить Telegram' };
  }

  return { success: true };
}

export async function saveExtensionSettings(agentId: string, payload: { isActive: boolean; config: TelegramExtensionSettings }) {
  if (!agentId) {
    return { error: 'Агент не найден' };
  }

  const admin = createAdminClient();
  const { error } = await admin.from('extension_settings').upsert(
    {
      agent_id: agentId,
      extension_type: 'telegram_notifications',
      is_active: payload.isActive,
      config: payload.config,
    },
    { onConflict: 'agent_id,extension_type' }
  );

  if (error) {
    return { error: 'Не удалось сохранить настройки' };
  }

  try {
    await registerTelegramNotificationsWebhook(process.env.NEXT_PUBLIC_APP_URL);
  } catch (registrationError) {
    console.error('[telegram-notifications] webhook registration failed', registrationError);
  }

  revalidatePath(`/dashboard/${agentId}/extensions`);
  return { success: true };
}
