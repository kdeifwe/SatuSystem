import { createServiceClient } from '@/lib/supabase/service';
import type { AudienceFilter } from './types';

function hasRequestedTags(tags: unknown, requested: string[]): boolean {
  if (requested.length === 0) return true;
  return Array.isArray(tags) && requested.every((tag) => tags.includes(tag));
}

function isBlocked(lead: Record<string, any>): boolean {
  return lead.status === 'blocked' || lead.attributes?.blocked === true || lead.attributes?.blocklisted === true;
}

export async function buildSmartCampaignAudience(campaignId: string, orgId: string, filter: AudienceFilter, supabase = createServiceClient()) {
  const signalTypes = Array.isArray(filter.signal_types) ? filter.signal_types : [];
  const minAgeHours = Number(filter.min_signal_age_hours ?? 0);
  const cutoff = new Date(Date.now() - Math.max(0, minAgeHours) * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from('lead_signals')
    .select('id, lead_id, signal_type, status, created_at, leads!inner(id, org_id, name, status, tags, attributes, channel_id, external_id)')
    .eq('org_id', orgId)
    .eq('status', 'active');

  if (signalTypes.length > 0) query = query.in('signal_type', signalTypes);
  if (minAgeHours > 0) query = query.lte('created_at', cutoff);

  const { data: signals, error } = await query;
  if (error) throw new Error(`Не удалось собрать аудиторию: ${error.message}`);

  const requestedStatuses = Array.isArray(filter.statuses) ? filter.statuses : [];
  const requestedTags = Array.isArray(filter.tags) ? filter.tags : [];
  const eligible = (signals ?? []).filter((signal: any) => {
    const lead = signal.leads;
    return lead && lead.org_id === orgId && !isBlocked(lead)
      && (requestedStatuses.length === 0 || requestedStatuses.includes(lead.status))
      && hasRequestedTags(lead.tags, requestedTags);
  });

  for (const signal of eligible) {
    const { error: insertError } = await supabase
      .from('smart_campaign_recipients')
      .insert({
        campaign_id: campaignId,
        lead_id: signal.lead_id,
        signal_id: signal.id,
        status: 'pending',
      });

    if (insertError && insertError.code !== '23505') {
      throw new Error(`Не удалось создать получателей: ${insertError.message}`);
    }
  }

  return { matched: eligible.length, recipientIds: eligible.map((signal: any) => signal.lead_id) };
}
