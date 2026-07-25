/**
 * Notification system for Telegram alerts
 * Handles enqueueing notifications with deduplication logic
 */

import { createAdminClient } from './supabase/admin';

export type NotificationEventType =
  | 'operator_needed'
  | 'channel_down'
  | 'ai_silent'
  | 'deal_won'
  | 'deal_lost'
  | 'new_lead'
  | 'contact_received'
  | 'repeat_touches_exhausted'
  | 'lead_returned'
  | 'scheduled_failed'
  | 'ai_error'
  | 'worker_down'
  | 'whatsapp_disconnected'
  | 'kaspi_auth_expired';

interface NotificationPayload {
  [key: string]: unknown;
}

/**
 * Deduplication rules by event type
 */
const DEDUP_CONFIG: Record<NotificationEventType, { window?: number; key: string[] }> = {
  operator_needed: { window: 10 * 60 * 1000, key: ['lead_id', 'event_type'] },
  channel_down: { window: 60 * 60 * 1000, key: ['channel_id', 'event_type', 'agent_id'] },
  ai_silent: { window: undefined, key: ['lead_id', 'event_type'] }, // until next success
  deal_won: { window: undefined, key: ['lead_id', 'event_type'] }, // on every transition to won
  deal_lost: { window: undefined, key: ['lead_id', 'event_type'] }, // on every transition to lost
  new_lead: { window: undefined, key: ['lead_id', 'event_type'] }, // once forever
  contact_received: { window: undefined, key: ['lead_id', 'contact_type', 'event_type'] }, // once per type
  repeat_touches_exhausted: { window: undefined, key: ['lead_id', 'event_type'] }, // once per cycle
  lead_returned: { window: 24 * 60 * 60 * 1000, key: ['lead_id', 'event_type'] },
  scheduled_failed: { window: undefined, key: ['scheduled_message_id', 'event_type'] }, // once per message
  ai_error: { window: 15 * 60 * 1000, key: ['agent_id', 'event_type'] },
  worker_down: { window: 15 * 60 * 1000, key: ['org_id', 'event_type'] },
  whatsapp_disconnected: { window: 2 * 60 * 1000, key: ['agent_id', 'event_type'] }, // notify once per 2 min per agent
  kaspi_auth_expired: { window: 60 * 60 * 1000, key: ['org_id', 'event_type'] }, // throttle repeated auth-expired alerts per org
};

interface EnqueueOptions {
  leadId?: string | null;
  agentId?: string | null;
  orgId?: string | null;
  channelId?: string | null;
  scheduledMessageId?: string | null;
  contactType?: string | null;
  skipDedupCheck?: boolean;
}

/**
 * Check if notification should be sent (dedup logic)
 */
export async function shouldSendNotification(
  admin: ReturnType<typeof createAdminClient>,
  eventType: NotificationEventType,
  payload: NotificationPayload,
  options: EnqueueOptions
): Promise<boolean> {
  const config = DEDUP_CONFIG[eventType];
  if (!config) return true;

  // Build dedup key from configured fields
  const dedupKeyValues: Record<string, string> = {
    lead_id: options.leadId || '',
    event_type: eventType,
    agent_id: options.agentId || '',
    channel_id: options.channelId || '',
    scheduled_message_id: options.scheduledMessageId || '',
    contact_type: options.contactType || '',
    org_id: options.orgId || '',
  };

  const relevantKeys = config.key.filter((k) => dedupKeyValues[k]);
  if (relevantKeys.length === 0) return true;

  const dedupValue = relevantKeys.map((k) => dedupKeyValues[k]).join(':');

  // Special cases without time-based dedup
  if (!config.window) {
    const { data, error } = await admin
      .from('notification_log')
      .select('id')
      .eq('event_type', eventType)
      .eq('lead_id', options.leadId || null)
      .eq('agent_id', options.agentId || null)
      .eq('org_id', options.orgId || null);

    if (!error && data && data.length > 0) {
      // Additional checks for specific event types
      if (eventType === 'ai_silent') {
        // Check if there's a newer 'ai' or 'operator' message after the inbound
        return false;
      }
      if (eventType === 'new_lead' || eventType === 'repeat_touches_exhausted') {
        // Never send again for same lead
        return false;
      }
      if (eventType === 'contact_received') {
        const { data: existing } = await admin
          .from('notification_log')
          .select('id')
          .eq('event_type', eventType)
          .eq('lead_id', options.leadId)
          .contains('payload', { contact_type: options.contactType });
        if (existing && existing.length > 0) return false;
      }
      if (eventType === 'scheduled_failed') {
        const { data: existing } = await admin
          .from('notification_log')
          .select('id')
          .eq('event_type', eventType)
          .eq('lead_id', options.leadId)
          .contains('payload', { scheduled_message_id: options.scheduledMessageId });
        if (existing && existing.length > 0) return false;
      }
    }
  } else {
    // Time-based dedup window
    const cutoffTime = new Date(Date.now() - config.window).toISOString();

    const query = admin.from('notification_log').select('id').eq('event_type', eventType).gt('sent_at', cutoffTime);

    // Add specific filters
    if (options.leadId) query.eq('lead_id', options.leadId);
    if (options.agentId) query.eq('agent_id', options.agentId);
    if (options.orgId) query.eq('org_id', options.orgId);

    const { data, error } = await query.limit(1);
    if (!error && data && data.length > 0) {
      return false;
    }
  }

  return true;
}

export async function getOrgAdminRecipientProfiles(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string
): Promise<string[]> {
  const { data: memberships, error: membershipsError } = await admin
    .from('org_members')
    .select('user_id, role')
    .eq('org_id', orgId)
    .in('role', ['owner', 'admin']);

  if (membershipsError || !memberships?.length) {
    return [];
  }

  const memberIds = memberships
    .map((membership) => membership.user_id)
    .filter(Boolean) as string[];

  if (memberIds.length === 0) {
    return [];
  }

  const { data: profiles, error: profilesError } = await admin
    .from('profiles')
    .select('id')
    .in('id', memberIds)
    .not('telegram_chat_id', 'is', null);

  if (profilesError) {
    return [];
  }

  return (profiles ?? []).map((profile) => profile.id).filter(Boolean) as string[];
}

export async function notifyOrgAdmins(orgId: string | null | undefined, message: string): Promise<boolean> {
  if (!orgId) {
    return false;
  }

  const admin = createAdminClient();
  const payload = { message };

  const shouldSend = await shouldSendNotification(admin, 'kaspi_auth_expired', payload, { orgId });
  if (!shouldSend) {
    console.log('[notifications] Dedup: skipping org admin alert', { orgId, eventType: 'kaspi_auth_expired' });
    return false;
  }

  const recipientProfileIds = await getOrgAdminRecipientProfiles(admin, orgId);
  if (recipientProfileIds.length === 0) {
    console.log('[notifications] No owner/admin recipients found for org alert', { orgId });
    return false;
  }

  const insertPromises = recipientProfileIds.map((recipientProfileId) =>
    admin.from('notification_log').insert({
      org_id: orgId,
      agent_id: null,
      lead_id: null,
      event_type: 'kaspi_auth_expired',
      recipient_profile_id: recipientProfileId,
      payload: { message },
      delivery_status: 'pending',
      attempts: 0,
    })
  );

  const results = await Promise.allSettled(insertPromises);
  const failed = results.filter((result) => result.status === 'rejected').length;

  if (failed > 0) {
    console.error('[notifications] Some org admin alert inserts failed', { orgId, failed, total: recipientProfileIds.length });
    return failed < recipientProfileIds.length;
  }

  console.log('[notifications] Enqueued org admin alert', { orgId, recipients: recipientProfileIds.length });
  return true;
}

/**
 * Enqueue a notification for sending
 * Returns true if notification was enqueued, false if deduplicated
 */
export async function enqueueNotification(
  eventType: NotificationEventType,
  leadId: string | null | undefined,
  agentId: string | null | undefined,
  payload: NotificationPayload,
  options: EnqueueOptions = {}
): Promise<boolean> {
  const admin = createAdminClient();

  try {
    // Get agent or org info
    let orgId = options.orgId;
    if (agentId && !orgId) {
      const { data: agent } = await admin.from('agents').select('org_id').eq('id', agentId).single();
      orgId = agent?.org_id;
    }

    if (!orgId && !leadId) {
      console.warn('[notifications] No org_id or lead_id provided', { eventType, agentId });
      return false;
    }

    // Check dedup
    if (!options.skipDedupCheck) {
      const shouldSend = await shouldSendNotification(admin, eventType, payload, { leadId, agentId, orgId, ...options });
      if (!shouldSend) {
        console.log('[notifications] Dedup: skipping notification', { eventType, leadId, agentId });
        return false;
      }
    }

    // Get lead info for building recipient list
    let leadData: { assigned_to?: string; agent_id?: string; channel?: string } | null = null;
    if (leadId) {
      const { data } = await admin
        .from('leads')
        .select('assigned_to, agent_id, channel')
        .eq('id', leadId)
        .single();
      leadData = data;
    }

    // Get extension settings to build recipient list
    const targetAgentId = agentId || leadData?.agent_id;
    const { data: settings } = await admin
      .from('extension_settings')
      .select('config')
      .eq('agent_id', targetAgentId)
      .eq('extension_type', 'telegram_notifications')
      .eq('is_active', true)
      .single();

    if (!settings?.config) {
      console.log('[notifications] No telegram_notifications config for agent', { agentId: targetAgentId });
      return false;
    }

    const config = settings.config as Record<string, unknown>;
    const events = config.events as Record<string, unknown>;
    const eventConfig = events?.[eventType] as Record<string, unknown>;

    if (!eventConfig?.enabled) {
      console.log('[notifications] Event type disabled in config', { eventType });
      return false;
    }

    // Build recipient list
    const recipients: string[] = [];
    const baseRecipients = (config.recipients as string[]) || [];

    // Add specific recipients based on event type
    if (eventType === 'operator_needed' || eventType === 'ai_silent') {
      if (leadData?.assigned_to) recipients.push(leadData.assigned_to);
    } else if (eventType === 'deal_won') {
      if (leadData?.assigned_to) recipients.push(leadData.assigned_to);
    } else if (eventType === 'contact_received') {
      if (leadData?.assigned_to) recipients.push(leadData.assigned_to);
    }

    // Add base recipients
    recipients.push(...baseRecipients);

    // Deduplicate
    const uniqueRecipients = [...new Set(recipients)];

    if (uniqueRecipients.length === 0) {
      console.log('[notifications] No recipients found for event', { eventType });
      return false;
    }

    // Insert notification log entries for each recipient
    const insertPromises = uniqueRecipients.map((recipientProfileId) =>
      admin.from('notification_log').insert({
        org_id: orgId,
        agent_id: agentId,
        lead_id: leadId,
        event_type: eventType,
        recipient_profile_id: recipientProfileId,
        payload: payload,
        delivery_status: 'pending',
        attempts: 0,
      })
    );

    const results = await Promise.allSettled(insertPromises);
    const failed = results.filter((r) => r.status === 'rejected').length;

    if (failed > 0) {
      console.error('[notifications] Some inserts failed', { eventType, failed, total: uniqueRecipients.length });
      return failed < uniqueRecipients.length; // Return true if at least some succeeded
    }

    console.log('[notifications] Enqueued notification', {
      eventType,
      leadId,
      agentId,
      recipients: uniqueRecipients.length,
    });
    return true;
  } catch (error) {
    console.error('[notifications] Error enqueuing notification:', error);
    return false;
  }
}

/**
 * Helper to get lead data for notification context
 */
export async function getLeadDataForNotification(leadId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('leads')
    .select(
      'id, name, channel, assigned_to, agent_id, status, tags, created_at, ai_enabled, ai_paused, last_inbound_at'
    )
    .eq('id', leadId)
    .single();

  if (error) {
    console.error('[notifications] Error fetching lead data:', error);
    return null;
  }

  return data;
}

/**
 * Helper to get agent data for notification context
 */
export async function getAgentDataForNotification(agentId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('agents')
    .select('id, name, org_id')
    .eq('id', agentId)
    .single();

  if (error) {
    console.error('[notifications] Error fetching agent data:', error);
    return null;
  }

  return data;
}

/**
 * Helper to get profile (recipient) data
 */
export async function getProfileDataForNotification(profileId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .select('id, full_name, email, telegram_chat_id')
    .eq('id', profileId)
    .single();

  if (error) {
    console.error('[notifications] Error fetching profile data:', error);
    return null;
  }

  return data;
}
