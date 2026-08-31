'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { createLeadSignalRecord, generateSmartBroadcastMessage } from '@/lib/smart-broadcasts/service';
import { validateGeneratedMessageAsync } from '@/lib/smart-broadcasts/prompt';
import { buildCampaignTimeline, pickPreviewSignals, type AudienceSignalItem } from './utils';

const SMART_BROADCAST_SIGNAL_TYPES = [
  'awaiting_funds',
  'awaiting_approval',
  'awaiting_decision',
  'competitor_comparison',
  'busy_later',
  'price_objection',
  'custom',
] as const;

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

async function getOrgIdForAgent(agentId: string): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from('agents').select('org_id').eq('id', agentId).maybeSingle();
  if (error || !data?.org_id) throw new Error('Agent not found');
  return data.org_id as string;
}

async function getAgentName(agentId: string): Promise<string> {
  const supabase = createServiceClient();
  const { data } = await supabase.from('agents').select('name').eq('id', agentId).maybeSingle();
  return (data?.name as string | undefined) ?? 'Агент';
}

async function getAgentKnowledgeBaseText(agentId: string): Promise<string> {
  const supabase = createServiceClient();
  const { data } = await supabase.from('agents').select('knowledge_base_principles').eq('id', agentId).maybeSingle();
  return typeof data?.knowledge_base_principles === 'string' ? data.knowledge_base_principles : '';
}

async function updateCampaignStatus(campaignId: string, status: string) {
  const supabase = createServiceClient();
  await supabase.from('smart_campaigns').update({ status }).eq('id', campaignId);
}

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch (error) {
    console.warn(`[smart-broadcast] revalidatePath skipped for ${path}`, error);
  }
}

export async function createSignalAction(agentId: string, payload: { leadId: string; signalType: string; description: string; rawQuote?: string }) {
  const orgId = await getOrgIdForAgent(agentId);
  await createLeadSignalRecord({
    orgId,
    leadId: payload.leadId,
    signalType: payload.signalType,
    description: payload.description,
    rawQuote: payload.rawQuote ?? null,
  });
  safeRevalidatePath(`/dashboard/${agentId}/broadcasts`);
  return { success: true };
}

export async function loadCampaignReviewDataAction(agentId: string, campaignId: string) {
  const orgId = await getOrgIdForAgent(agentId);
  const supabase = createServiceClient();

  const { data: campaign, error: campaignError } = await supabase
    .from('smart_campaigns')
    .select('id, name, requires_approval')
    .eq('id', campaignId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (campaignError || !campaign) throw new Error('Campaign not found');

  const { data: recipients, error: recipientsError } = await supabase
    .from('smart_campaign_recipients')
    .select('id, lead_id, generated_message, edited_message, status, skip_reason, created_at, leads(name), lead_signals(signal_type, description, raw_quote)')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true });

  if (recipientsError) throw recipientsError;

  return {
    success: true,
    campaign,
    recipients: (recipients ?? []).map((recipient: Record<string, unknown>) => ({
      id: recipient.id as string,
      leadId: recipient.lead_id as string,
      leadName: ((recipient.leads as { name?: string } | null)?.name) ?? 'клиент',
      generatedMessage: ((recipient.edited_message as string | null) ?? (recipient.generated_message as string | null) ?? ''),
      status: (recipient.status as string) ?? 'generated',
      skipReason: (recipient.skip_reason as string | null) ?? null,
      signalType: ((recipient.lead_signals as { signal_type?: string } | null)?.signal_type) ?? null,
      signalDescription: ((recipient.lead_signals as { description?: string } | null)?.description) ?? null,
      rawQuote: ((recipient.lead_signals as { raw_quote?: string | null } | null)?.raw_quote) ?? null,
    })),
  };
}

export async function loadCampaignDashboardDataAction(agentId: string, campaignId: string) {
  const orgId = await getOrgIdForAgent(agentId);
  const supabase = createServiceClient();

  const { data: campaign, error: campaignError } = await supabase
    .from('smart_campaigns')
    .select('id, name, status')
    .eq('id', campaignId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (campaignError || !campaign) throw new Error('Campaign not found');

  const { data: recipients, error: recipientsError } = await supabase
    .from('smart_campaign_recipients')
    .select('id, lead_id, status, skip_reason, generated_message, edited_message, created_at, sent_at, replied_at, leads(name)')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true });

  if (recipientsError) throw recipientsError;

  const stats = (recipients ?? []).reduce((acc, recipient) => {
    const status = (recipient.status as string) ?? 'pending';
    if (status === 'sent') {
      acc.sent += 1;
    } else if (status === 'replied') {
      acc.replied += 1;
    } else if (status === 'failed') {
      acc.errors += 1;
    } else if (status === 'skipped') {
      acc.skipped += 1;
    }
    return acc;
  }, { sent: 0, replied: 0, errors: 0, skipped: 0 });

  return {
    success: true,
    campaign,
    stats,
    timeline: buildCampaignTimeline((recipients ?? []) as Array<{ status: string; sent_at?: string | null; replied_at?: string | null; created_at?: string | null }>),
    recipients: (recipients ?? []).map((recipient: Record<string, unknown>) => ({
      id: recipient.id as string,
      leadId: recipient.lead_id as string,
      leadName: ((recipient.leads as { name?: string } | null)?.name) ?? 'клиент',
      status: (recipient.status as string) ?? 'pending',
      generatedMessage: ((recipient.edited_message as string | null) ?? (recipient.generated_message as string | null) ?? ''),
      skipReason: (recipient.skip_reason as string | null) ?? null,
    })),
  };
}

export async function updateCampaignRecipientAction(agentId: string, payload: {
  campaignId: string;
  recipientId: string;
  generatedMessage?: string;
  action: 'update' | 'approve' | 'skip';
}) {
  const orgId = await getOrgIdForAgent(agentId);
  const supabase = createServiceClient();
  const { data: campaign, error: campaignError } = await supabase
    .from('smart_campaigns')
    .select('id')
    .eq('id', payload.campaignId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (campaignError || !campaign) throw new Error('Campaign not found');

  const updates: Record<string, unknown> = {};
  if (payload.generatedMessage !== undefined) {
    updates.generated_message = payload.generatedMessage;
    updates.edited_message = payload.generatedMessage;
  }

  if (payload.action === 'approve') {
    updates.status = 'approved';
    updates.skip_reason = null;
  } else if (payload.action === 'skip') {
    updates.status = 'skipped';
    updates.skip_reason = 'user_skipped';
  } else if (payload.generatedMessage !== undefined) {
    updates.status = 'generated';
  }

  await supabase.from('smart_campaign_recipients').update(updates).eq('id', payload.recipientId).eq('campaign_id', payload.campaignId);
  safeRevalidatePath(`/dashboard/${agentId}/broadcasts`);
  return { success: true };
}

async function getAudienceSignals(orgId: string, payload: { signalTypes: string[]; minSignalAgeHours: number }): Promise<AudienceSignalItem[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('lead_signals')
    .select('id, lead_id, signal_type, description, raw_quote, created_at')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .in('signal_type', payload.signalTypes.length > 0 ? payload.signalTypes : SMART_BROADCAST_SIGNAL_TYPES)
    .order('created_at', { ascending: true });

  return ((data ?? []) as Array<{ id: string; lead_id: string; signal_type: string; description: string; raw_quote: string | null; created_at: string }>).filter((signal) => {
    const createdAt = new Date(signal.created_at);
    if (Number.isNaN(createdAt.getTime())) {
      return false;
    }
    const ageHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
    return payload.minSignalAgeHours <= 0 || ageHours >= payload.minSignalAgeHours;
  }).map((signal) => ({
    id: signal.id,
    lead_id: signal.lead_id,
    signal_type: signal.signal_type,
    description: signal.description,
    raw_quote: signal.raw_quote,
    status: 'active',
    created_at: signal.created_at,
  } satisfies AudienceSignalItem));
}

async function buildPreviewMessages(agentId: string, orgId: string, payload: { signalTypes: string[]; minSignalAgeHours: number; goalInstruction: string; maxMessageLength: number }, previewSignals: AudienceSignalItem[]) {
  const preview: Array<{ leadId: string; leadName: string; message: string; rawQuote?: string | null }> = [];

  for (const signal of previewSignals) {
    const leadData = await createServiceClient().from('leads').select('id, name').eq('id', signal.lead_id).maybeSingle();
    const leadName = typeof leadData.data?.name === 'string' && leadData.data.name.trim() ? leadData.data.name : 'клиент';
    const signalRawQuote = signal.raw_quote ?? null;
    let previewMessage = 'Не удалось сгенерировать сообщение';
    try {
      const generated = await generateSmartBroadcastMessage({
        agentId,
        orgId,
        leadId: signal.lead_id,
        leadName,
        signal: {
          id: signal.id,
          lead_id: signal.lead_id,
          signal_type: signal.signal_type,
          description: signal.description,
          raw_quote: signalRawQuote,
          status: 'active',
          created_at: signal.created_at,
        },
        goalInstruction: payload.goalInstruction || 'Спроси, как у клиента дела и предложи продолжить разговор.',
        maxMessageLength: payload.maxMessageLength,
      });

      const validated = await validateGeneratedMessageAsync(generated.text, payload.maxMessageLength);
      if (!validated.valid) {
        throw new Error(validated.error === 'injection_leak'
          ? 'Generated message contains a possible injection leak'
          : validated.error === 'refusal'
            ? 'Generated message contains refusal language'
            : 'Generated message failed validation');
      }
      previewMessage = validated.normalized ?? generated.text;
    } catch (generationError: unknown) {
      const errorMessage = generationError instanceof Error ? generationError.message : String(generationError);
      previewMessage = `ERROR: ${errorMessage}`;
    }

    preview.push({
      leadId: signal.lead_id,
      leadName,
      message: previewMessage,
      rawQuote: signal.raw_quote,
    });
  }

  return preview;
}

export async function generateSmartBroadcastPreviewAction(agentId: string, payload: {
  signalTypes: string[];
  minSignalAgeHours: number;
  goalInstruction: string;
  maxMessageLength: number;
}) {
  const orgId = await getOrgIdForAgent(agentId);
  const signals = await getAudienceSignals(orgId, payload);
  const previewSignals = pickPreviewSignals(signals, payload.signalTypes, payload.minSignalAgeHours, 5);
  const preview = await buildPreviewMessages(agentId, orgId, payload, previewSignals);
  return { success: true, preview };
}

export async function createSmartCampaignAction(agentId: string, payload: {
  signalTypes: string[];
  minSignalAgeHours: number;
  goalInstruction: string;
  requiresApproval: boolean;
  pacing: number;
  respectWorkHours: boolean;
  maxMessageLength: number;
}) {
  const orgId = await getOrgIdForAgent(agentId);
  const supabase = createServiceClient();

  const { data: campaign, error: campaignError } = await supabase.from('smart_campaigns').insert({
    org_id: orgId,
    name: `Кампания ${new Date().toLocaleDateString('ru-RU')}`,
    goal_instruction: payload.goalInstruction || 'Спроси, как у клиента дела и предложи продолжить разговор.',
    audience_filter: {
      signal_types: payload.signalTypes,
      min_signal_age_hours: payload.minSignalAgeHours,
      statuses: ['active'],
    },
    requires_approval: payload.requiresApproval,
    send_pacing_per_minute: payload.pacing,
    respect_work_hours: payload.respectWorkHours,
    max_message_length: payload.maxMessageLength,
    status: 'generating',
    created_by: null,
  }).select().single();

  if (campaignError || !campaign) throw new Error(campaignError?.message ?? 'Failed to create campaign');

  const signals = await getAudienceSignals(orgId, payload);
  const seenLeads = new Set<string>();
  const recipients: Array<{ lead_id: string; signal_id: string }> = [];

  for (const signal of signals) {
    const leadId = (signal.lead_id as string | null) ?? '';
    if (!leadId || seenLeads.has(leadId)) continue;

    seenLeads.add(leadId);
    recipients.push({ lead_id: leadId, signal_id: signal.id as string });
  }

  const insertedRecipients = [] as Array<{ lead_id: string; signal_id: string; generated_message?: string | null; status?: string }>; 
  for (const recipient of recipients) {
    const { data: insertedRecipientData, error: insertRecipientError } = await supabase.from('smart_campaign_recipients').insert({
      campaign_id: campaign.id,
      lead_id: recipient.lead_id,
      signal_id: recipient.signal_id,
      status: 'pending',
    }).select('id, lead_id, signal_id').single();

    if (!insertRecipientError && insertedRecipientData) {
      insertedRecipients.push({ lead_id: recipient.lead_id, signal_id: recipient.signal_id });
    }
  }

  await updateCampaignStatus(campaign.id, payload.requiresApproval ? 'ready_for_review' : 'sending');

  const previewSignals = pickPreviewSignals(signals, payload.signalTypes, payload.minSignalAgeHours, 3);
  const preview: Array<{ leadId: string; leadName: string; message: string; rawQuote?: string | null }> = [];
  const recipientByLeadId = new Map(insertedRecipients.map((recipient) => [recipient.lead_id, recipient]));
  for (const signal of previewSignals) {
    const recipient = recipientByLeadId.get(signal.lead_id);
    if (!recipient) continue;

    const leadData = await supabase.from('leads').select('id, name').eq('id', recipient.lead_id).maybeSingle();
    const leadName = typeof leadData.data?.name === 'string' && leadData.data.name.trim() ? leadData.data.name : 'клиент';
    const signalRawQuote = signal.raw_quote ?? null;
    let previewMessage = 'Не удалось сгенерировать сообщение';
    try {
      const generated = await generateSmartBroadcastMessage({
        agentId,
        orgId,
        leadId: recipient.lead_id,
        leadName,
        signal: {
          id: signal.id,
          lead_id: signal.lead_id,
          signal_type: signal.signal_type,
          description: signal.description,
          raw_quote: signalRawQuote,
          status: 'active',
          created_at: signal.created_at,
        },
        goalInstruction: payload.goalInstruction || 'Спроси, как у клиента дела и предложи продолжить разговор.',
        maxMessageLength: payload.maxMessageLength,
      });

      const validated = await validateGeneratedMessageAsync(generated.text, payload.maxMessageLength);
      if (!validated.valid) {
        throw new Error(validated.error === 'injection_leak'
          ? 'Generated message contains a possible injection leak'
          : validated.error === 'refusal'
            ? 'Generated message contains refusal language'
            : 'Generated message failed validation');
      }
      const normalizedMessage = validated.normalized ?? generated.text;

      await supabase.from('smart_campaign_recipients').update({
        generated_message: normalizedMessage,
        status: 'generated',
        ai_call_log_id: generated.aiCallId,
      }).eq('campaign_id', campaign.id).eq('lead_id', recipient.lead_id);

      previewMessage = normalizedMessage;
    } catch (generationError: unknown) {
      const errorMessage = generationError instanceof Error ? generationError.message : String(generationError);
      previewMessage = `ERROR: ${errorMessage}`;
      await supabase.from('smart_campaign_recipients').update({
        status: 'failed',
        skip_reason: errorMessage,
      }).eq('campaign_id', campaign.id).eq('lead_id', recipient.lead_id);
    }

    preview.push({
      leadId: recipient.lead_id,
      leadName,
      message: previewMessage,
      rawQuote: signal.raw_quote,
    });
  }

  safeRevalidatePath(`/dashboard/${agentId}/broadcasts`);
  return { success: true, campaignId: campaign.id, preview, recipientCount: insertedRecipients.length, requiresApproval: payload.requiresApproval };
}

export async function generateCampaignMessagesAction(agentId: string, campaignId: string) {
  const orgId = await getOrgIdForAgent(agentId);
  const supabase = createServiceClient();
  const { data: campaign } = await supabase.from('smart_campaigns').select('*').eq('id', campaignId).maybeSingle();
  if (!campaign) throw new Error('Campaign not found');

  const { data: recipients } = await supabase.from('smart_campaign_recipients').select('*').eq('campaign_id', campaignId).eq('status', 'pending');
  const pendingRecipients = recipients ?? [];

  for (const recipient of pendingRecipients) {
    const signalData = await supabase.from('lead_signals').select('*').eq('id', recipient.signal_id).maybeSingle();
    const leadData = await supabase.from('leads').select('name').eq('id', recipient.lead_id).maybeSingle();
    const signal = signalData.data as { id: string; lead_id: string; signal_type: string; description: string; raw_quote: string | null; created_at: string } | null;
    if (!signal) continue;

    try {
      const generated = await generateSmartBroadcastMessage({
        agentId,
        orgId,
        leadId: recipient.lead_id,
        leadName: (leadData.data?.name as string | undefined) ?? 'клиент',
        signal: {
          id: signal.id,
          lead_id: signal.lead_id,
          signal_type: signal.signal_type,
          description: signal.description,
          raw_quote: signal.raw_quote,
          status: 'active',
          created_at: signal.created_at,
        },
        goalInstruction: campaign.goal_instruction,
        maxMessageLength: campaign.max_message_length ?? 320,
      });
      const validated = await validateGeneratedMessageAsync(generated.text, campaign.max_message_length ?? 320);
      if (!validated.valid) {
        throw new Error(validated.error === 'injection_leak'
          ? 'Generated message contains a possible injection leak'
          : validated.error === 'refusal'
            ? 'Generated message contains refusal language'
            : 'Generated message failed validation');
      }
      const normalizedMessage = validated.normalized ?? generated.text;
      await supabase.from('smart_campaign_recipients').update({ generated_message: normalizedMessage, status: 'generated', ai_call_log_id: generated.aiCallId }).eq('id', recipient.id);
    } catch (generationError: unknown) {
      const errorMessage = generationError instanceof Error ? generationError.message : String(generationError);
      await supabase.from('smart_campaign_recipients').update({ status: 'failed', skip_reason: errorMessage }).eq('id', recipient.id);
    }
  }

  await updateCampaignStatus(campaignId, 'ready_for_review');
  safeRevalidatePath(`/dashboard/${agentId}/broadcasts`);
  return { success: true, count: pendingRecipients.length };
}

export async function approveCampaignRecipientsAction(agentId: string, campaignId: string) {
  const supabase = createServiceClient();
  await supabase.from('smart_campaign_recipients').update({ status: 'approved' }).eq('campaign_id', campaignId).eq('status', 'generated');
  safeRevalidatePath(`/dashboard/${agentId}/broadcasts`);
  return { success: true };
}

export async function sendCampaignRecipientsAction(agentId: string, campaignId: string) {
  const supabase = createServiceClient();
  const { data: recipients } = await supabase.from('smart_campaign_recipients').select('*').eq('campaign_id', campaignId).eq('status', 'approved');
  const pendingRecipients = recipients ?? [];

  for (const recipient of pendingRecipients) {
    const leadData = await supabase.from('leads').select('id, attributes, name').eq('id', recipient.lead_id).maybeSingle();
    const lead = leadData.data as { id: string; attributes?: Record<string, unknown>; name?: string } | null;

    const lastActivity = lead?.attributes?.last_message_at as string | undefined;
    const hasRecentActivity = Boolean(lastActivity && Date.now() - new Date(lastActivity).getTime() < 24 * 60 * 60 * 1000);

    if (lead?.attributes?.channel_type === 'whatsapp' && !hasRecentActivity) {
      await supabase.from('smart_campaign_recipients').update({ status: 'skipped', skip_reason: 'whatsapp_template_required' }).eq('id', recipient.id);
      continue;
    }

    await supabase.from('smart_campaign_recipients').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', recipient.id);
  }

  await updateCampaignStatus(campaignId, 'done');
  safeRevalidatePath(`/dashboard/${agentId}/broadcasts`);
  return { success: true, count: pendingRecipients.length };
}
