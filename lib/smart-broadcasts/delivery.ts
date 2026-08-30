import { createServiceClient } from '@/lib/supabase/service';
import { sendWhatsAppMessage } from '@/lib/channels/whatsapp';
import { sendTelegramText } from '@/lib/channels/telegram-client';
import { getOrganizationTimezone, isWithinWorkHours } from '@/lib/extensions/work-hours';
import type { SmartDeliveryAdapter } from './types';

const MINUTE_MS = 60_000;

async function hasRecentInbound(leadId: string, supabase = createServiceClient()): Promise<boolean> {
  const { data: conversations } = await supabase.from('conversations').select('id').eq('lead_id', leadId);
  const ids = (conversations ?? []).map((row: any) => row.id).filter(Boolean);
  if (ids.length === 0) return false;
  const { data: message } = await supabase.from('messages').select('created_at').in('conversation_id', ids).eq('sender', 'user').order('created_at', { ascending: false }).limit(1).maybeSingle();
  return Boolean(message?.created_at && Date.now() - new Date(message.created_at).getTime() <= 24 * 60 * 60 * 1000);
}

async function lastInboundIsWithinWhatsAppWindow(leadId: string, supabase = createServiceClient()): Promise<boolean> {
  const { data: conversations } = await supabase.from('conversations').select('id').eq('lead_id', leadId);
  const ids = (conversations ?? []).map((row: any) => row.id).filter(Boolean);
  if (ids.length === 0) return false;
  const { data: message } = await supabase.from('messages').select('created_at').in('conversation_id', ids).eq('sender', 'user').order('created_at', { ascending: false }).limit(1).maybeSingle();
  return Boolean(message?.created_at && Date.now() - new Date(message.created_at).getTime() <= 24 * 60 * 60 * 1000);
}

async function defaultAdapter(): Promise<SmartDeliveryAdapter> {
  return {
    async send({ lead, channel, text }) {
      const credentials = channel.credentials ?? {};
      if (channel.type === 'whatsapp') {
        await sendWhatsAppMessage(credentials.phoneNumberId ?? credentials.phone_number_id, credentials.accessToken ?? credentials.access_token, lead.external_id, text);
        return;
      }
      if (channel.type === 'telegram') {
        await sendTelegramText(channel.id, lead.external_id, text);
        return;
      }
      throw new Error(`Канал ${channel.type ?? 'unknown'} не поддерживает отправку`);
    },
  };
}

export async function sendApprovedSmartRecipients(args: {
  campaignId: string;
  orgId: string;
  adapter?: SmartDeliveryAdapter;
  supabase?: ReturnType<typeof createServiceClient>;
}) {
  const supabase = args.supabase ?? createServiceClient();
  const { data: campaign, error: campaignError } = await supabase.from('smart_campaigns').select('*').eq('id', args.campaignId).eq('org_id', args.orgId).single();
  if (campaignError || !campaign) throw new Error('Кампания не найдена');
  const timezone = await getOrganizationTimezone(args.orgId, supabase);
  const adapter = args.adapter ?? await defaultAdapter();
  const { data: recipients, error } = await supabase.from('smart_campaign_recipients').select('*, leads!inner(id, name, external_id, channel_id, status, attributes), lead_signals!inner(id)').eq('campaign_id', args.campaignId).eq('status', 'approved');
  if (error) throw new Error(`Не удалось загрузить одобренных получателей: ${error.message}`);

  await supabase.from('smart_campaigns').update({ status: 'sending' }).eq('id', args.campaignId);
  const pacing = Math.max(1, Math.min(20, Number(campaign.send_pacing_per_minute ?? 5)));
  const interval = MINUTE_MS / pacing;
  const results: Array<Record<string, unknown>> = [];
  let lastSentAt = 0;

  for (const candidate of recipients ?? []) {
    const lead = (candidate as any).leads;
    if (!lead || lead.status === 'blocked' || lead.attributes?.blocked === true || lead.attributes?.blocklisted === true) {
      await supabase.from('smart_campaign_recipients').update({ status: 'skipped', skip_reason: 'blocked' }).eq('id', candidate.id).eq('status', 'approved');
      results.push({ id: candidate.id, status: 'skipped', reason: 'blocked' });
      continue;
    }

    const { data: channel } = await supabase.from('channels').select('id, type, credentials').eq('id', lead.channel_id).maybeSingle();
    if (!channel) {
      await supabase.from('smart_campaign_recipients').update({ status: 'failed', skip_reason: 'channel_not_found' }).eq('id', candidate.id).eq('status', 'approved');
      results.push({ id: candidate.id, status: 'failed', reason: 'channel_not_found' });
      continue;
    }

    const withinHours = isWithinWorkHours(new Date(Date.now()), timezone);
    if (campaign.respect_work_hours && !withinHours) {
      await supabase.from('smart_campaign_recipients').update({ status: 'skipped', skip_reason: 'outside_work_hours' }).eq('id', candidate.id).eq('status', 'approved');
      results.push({ id: candidate.id, status: 'skipped', reason: 'outside_work_hours' });
      continue;
    }

    if (channel.type === 'whatsapp' && !(await lastInboundIsWithinWhatsAppWindow(lead.id, supabase))) {
      await supabase.from('smart_campaign_recipients').update({ status: 'skipped', skip_reason: 'whatsapp_24h_window_expired' }).eq('id', candidate.id).eq('status', 'approved');
      results.push({ id: candidate.id, status: 'skipped', reason: 'whatsapp_24h_window_expired' });
      continue;
    }

    const now = Date.now();
    const wait = Math.max(0, interval - (now - lastSentAt));
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

    const { data: locked, error: lockError } = await supabase.from('smart_campaign_recipients').update({ status: 'sending' }).eq('id', candidate.id).eq('status', 'approved').select().maybeSingle();
    if (lockError || !locked) continue;

    const text = candidate.edited_message || candidate.generated_message;
    try {
      if (!text) throw new Error('empty_message');
      await adapter.send({ lead, channel, text });
      await supabase.from('smart_campaign_recipients').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', candidate.id).eq('status', 'sending');
      lastSentAt = Date.now();
      results.push({ id: candidate.id, status: 'sent' });
    } catch (sendError) {
      const reason = sendError instanceof Error ? sendError.message : String(sendError);
      await supabase.from('smart_campaign_recipients').update({ status: 'failed', skip_reason: reason }).eq('id', candidate.id).eq('status', 'sending');
      results.push({ id: candidate.id, status: 'failed', reason });
    }
  }

  const { count } = await supabase.from('smart_campaign_recipients').select('id', { count: 'exact', head: true }).eq('campaign_id', args.campaignId).in('status', ['approved', 'sending', 'pending', 'generated']);
  if (!count) await supabase.from('smart_campaigns').update({ status: 'done', finished_at: new Date().toISOString() }).eq('id', args.campaignId);
  return results;
}
