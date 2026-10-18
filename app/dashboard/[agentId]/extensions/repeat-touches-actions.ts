'use server';

import { revalidatePath } from 'next/cache';
import { requireAgentAccess } from '@/lib/server/require-auth';
import { normalizeRepeatTouchesConfig, type RepeatTouchesConfig } from '@/lib/server/follow-ups/config';

export type RepeatTouchesSettings = {
  is_active: boolean;
  config: RepeatTouchesConfig;
};

export async function getRepeatTouchesSettings(agentId: string): Promise<RepeatTouchesSettings | { error: string }> {
  const access = await requireAgentAccess(agentId);
  if (!access.ok) return { error: 'Нет доступа' };

  const { data } = await access.admin
    .from('extension_settings')
    .select('is_active, config')
    .eq('agent_id', agentId)
    .eq('extension_type', 'repeat_touches')
    .maybeSingle();

  return {
    is_active: Boolean(data?.is_active),
    config: normalizeRepeatTouchesConfig(data?.config),
  };
}

export async function saveRepeatTouchesSettings(
  agentId: string,
  input: { is_active: boolean; config: Partial<RepeatTouchesConfig> },
): Promise<{ success: true } | { error: string }> {
  const access = await requireAgentAccess(agentId);
  if (!access.ok) return { error: 'Нет доступа' };

  const { data: existing } = await access.admin
    .from('extension_settings')
    .select('is_active, config')
    .eq('agent_id', agentId)
    .eq('extension_type', 'repeat_touches')
    .maybeSingle();

  const previous = normalizeRepeatTouchesConfig(existing?.config);
  const next = normalizeRepeatTouchesConfig({ ...input.config, activated_at: previous.activated_at });

  // Касания действуют только на диалоги после момента включения: старую базу не трогаем.
  if (input.is_active) {
    if (!existing?.is_active || !next.activated_at) next.activated_at = new Date().toISOString();
  } else {
    next.activated_at = null;
  }

  const { error } = await access.admin.from('extension_settings').upsert(
    {
      agent_id: agentId,
      extension_type: 'repeat_touches',
      is_active: input.is_active,
      config: next,
      updated_by: access.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'agent_id,extension_type' },
  );

  if (error) return { error: 'Не удалось сохранить настройки' };

  revalidatePath(`/dashboard/${agentId}/extensions`);
  return { success: true };
}
