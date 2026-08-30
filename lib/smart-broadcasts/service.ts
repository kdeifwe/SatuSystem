import { createServiceClient } from '@/lib/supabase/service';
import { geminiFetch, GEMINI_CHAT_MODEL } from '@/lib/server/ai/gemini-client';
import { buildSmartBroadcastSystemPrompt, buildSmartBroadcastUserPrompt, validateGeneratedMessageAsync } from './prompt';
import { buildSmartCampaignAudience } from './audience';
import type { AudienceFilter, SmartCampaign } from './types';

export interface SmartBroadcastSignalRecord {
  id: string;
  lead_id: string;
  signal_type: string;
  description: string;
  raw_quote: string | null;
  status: string;
  created_at: string;
}

export interface SmartBroadcastCampaignContext {
  agentId: string;
  orgId: string;
  leadId: string;
  leadName: string;
  signal: SmartBroadcastSignalRecord;
  goalInstruction: string;
  maxMessageLength: number;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function extractUsageMetadata(body: any) {
  const usage = body?.usageMetadata ?? {};
  return {
    tokensInput: Number(usage.promptTokenCount ?? 0),
    tokensOutput: Number(usage.candidatesTokenCount ?? 0),
  };
}

async function logAiCall(conversationId: string | null, request: unknown, response: unknown, tokensInput?: number, tokensOutput?: number, latencyMs?: number): Promise<string | null> {
  const supabase = createServiceClient();
  try {
    const { data, error } = await supabase.from('ai_call_logs').insert({
      conversation_id: conversationId,
      request,
      response,
      tokens_input: tokensInput ?? 0,
      tokens_output: tokensOutput ?? 0,
      latency_ms: latencyMs ?? 0,
    }).select('id').single();

    if (error) {
      const message = `[smart-broadcast] failed to write ai_call_logs: ${error.message}`;
      console.warn(message, error);
      throw new Error(message);
    }

    return data?.id ?? null;
  } catch (error) {
    console.error('[smart-broadcast] failed to write ai_call_logs', error);
    throw error;
  }
}

export async function createLeadSignalRecord(args: {
  orgId: string;
  leadId: string;
  signalType: string;
  description: string;
  rawQuote?: string | null;
  sourceMessageId?: string | null;
  suggestedFollowUpAt?: string | null;
}) {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from('lead_signals').insert({
    org_id: args.orgId,
    lead_id: args.leadId,
    signal_type: args.signalType,
    description: args.description,
    raw_quote: args.rawQuote ?? null,
    source_message_id: args.sourceMessageId ?? null,
    suggested_follow_up_at: args.suggestedFollowUpAt ?? null,
    status: 'active',
  }).select().single();

  if (error) throw new Error(error.message);
  return data;
}

export async function generateSmartBroadcastMessage(context: SmartBroadcastCampaignContext): Promise<{ text: string; aiCallId: string | null }> {
  const supabase = createServiceClient();

  const { data: agentData } = await supabase.from('agents').select('name, role, tone_of_voice, human_communication_style, knowledge_base_principles').eq('id', context.agentId).maybeSingle();
  const { data: orgData } = await supabase.from('organizations').select('name').eq('id', context.orgId).maybeSingle();

  const systemPrompt = buildSmartBroadcastSystemPrompt({
    agent: {
      name: normalizeString(agentData?.name),
      role: normalizeString(agentData?.role),
      tone_of_voice: normalizeString(agentData?.tone_of_voice),
      human_communication_style: normalizeString(agentData?.human_communication_style),
    },
    organization: { name: normalizeString(orgData?.name) || 'Компания' },
    lead: { name: await getLeadName(context.leadId) },
    signal: {
      created_at: context.signal.created_at,
      raw_quote: context.signal.raw_quote,
      description: context.signal.description,
    },
    campaign: {
      goal_instruction: context.goalInstruction,
      max_message_length: context.maxMessageLength,
    },
  });

  const userPrompt = buildSmartBroadcastUserPrompt();
  const requestPayload = {
    system_prompt: systemPrompt,
    user_prompt: userPrompt,
    lead_id: context.leadId,
    signal_id: context.signal.id,
  };

  const startedAt = Date.now();
  let generatedText = '';
  let aiCallId: string | null = null;
  let tokensInput = 0;
  let tokensOutput = 0;

  async function generateFromGemini(maxOutputTokens: number, retryCount = 0): Promise<string> {
    const body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens,
        thinkingConfig: { thinkingBudget: 0 },
      },
    };

    const response = await geminiFetch(GEMINI_CHAT_MODEL, 'generateContent', body);
    const text = await response.text();
    const bodyJson = JSON.parse(text);
    const usageMetadata = extractUsageMetadata(bodyJson);
    tokensInput += usageMetadata.tokensInput;
    tokensOutput += usageMetadata.tokensOutput;
    const candidateText = bodyJson?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const finishReason = bodyJson?.candidates?.[0]?.finishReason ?? bodyJson?.candidates?.[0]?.finish_reason;
    const normalizedCandidate = normalizeString(candidateText).replace(/^"|"$/g, '').trim();

    if (finishReason === 'MAX_TOKENS' && retryCount === 0) {
      const nextMax = Math.min(32768, Math.max(maxOutputTokens * 2, maxOutputTokens + 1024));
      return generateFromGemini(nextMax, retryCount + 1);
    }

    if (finishReason === 'MAX_TOKENS') {
      throw new Error('Gemini response was truncated twice (MAX_TOKENS)');
    }

    if (!normalizedCandidate) {
      if (retryCount === 0) {
        const nextMax = Math.min(32768, Math.max(maxOutputTokens * 2, maxOutputTokens + 1024));
        return generateFromGemini(nextMax, retryCount + 1);
      }
      throw new Error('Gemini returned an empty response');
    }

    return normalizedCandidate;
  }

  generatedText = await generateFromGemini(256);
  const validated = await validateGeneratedMessageAsync(generatedText, context.maxMessageLength);
  if (!validated.valid) {
    throw new Error(
      validated.error === 'empty'
        ? 'Generated message is empty'
        : validated.error === 'refusal'
        ? 'Generated message contains refusal language'
        : 'Generated message failed validation'
    );
  }
  const finalText = validated.normalized ?? generatedText;

  aiCallId = await logAiCall(null, requestPayload, { text: finalText }, tokensInput, tokensOutput, Date.now() - startedAt);

  return { text: finalText, aiCallId };
}

export async function createSmartCampaign(args: {
  orgId: string;
  createdBy?: string | null;
  name: string;
  goalInstruction: string;
  audienceFilter: AudienceFilter;
  requiresApproval?: boolean;
  sendPacingPerMinute?: number;
  respectWorkHours?: boolean;
  maxMessageLength?: number;
}) {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from('smart_campaigns').insert({
    org_id: args.orgId,
    created_by: args.createdBy ?? null,
    name: args.name,
    goal_instruction: args.goalInstruction,
    audience_filter: args.audienceFilter,
    ...(args.requiresApproval === undefined ? {} : { requires_approval: args.requiresApproval }),
    ...(args.sendPacingPerMinute === undefined ? {} : { send_pacing_per_minute: args.sendPacingPerMinute }),
    ...(args.respectWorkHours === undefined ? {} : { respect_work_hours: args.respectWorkHours }),
    ...(args.maxMessageLength === undefined ? {} : { max_message_length: args.maxMessageLength }),
  }).select().single();
  if (error) throw new Error(`Не удалось создать кампанию: ${error.message}`);
  return data as SmartCampaign;
}

export async function generateSmartCampaign(campaignId: string, orgId: string) {
  const supabase = createServiceClient();
  const { data: campaign, error: campaignError } = await supabase.from('smart_campaigns').select('*').eq('id', campaignId).eq('org_id', orgId).single();
  if (campaignError || !campaign) throw new Error('Кампания не найдена');

  await supabase.from('smart_campaigns').update({ status: 'generating', started_at: new Date().toISOString() }).eq('id', campaignId);
  await buildSmartCampaignAudience(campaignId, orgId, campaign.audience_filter ?? {});

  const { data: recipients, error: recipientsError } = await supabase
    .from('smart_campaign_recipients')
    .select('id, lead_id, signal_id, status, leads!inner(id, name), lead_signals!inner(id, lead_id, signal_type, description, raw_quote, status, created_at)')
    .eq('campaign_id', campaignId)
    .eq('status', 'pending');
  if (recipientsError) throw new Error(`Не удалось загрузить получателей: ${recipientsError.message}`);

  let generated = 0;
  let failed = 0;
  for (const recipient of recipients ?? []) {
    try {
      const lead = (recipient as any).leads;
      const signal = (recipient as any).lead_signals;
      const result = await generateSmartBroadcastMessage({
        agentId: campaign.audience_filter?.agent_id,
        orgId,
        leadId: recipient.lead_id,
        leadName: lead?.name ?? 'клиент',
        signal,
        goalInstruction: campaign.goal_instruction,
        maxMessageLength: campaign.max_message_length,
      });
      await supabase.from('smart_campaign_recipients').update({ generated_message: result.text, ai_call_log_id: result.aiCallId, status: 'generated' }).eq('id', recipient.id).eq('status', 'pending');
      generated += 1;
    } catch (error) {
      failed += 1;
      await supabase.from('smart_campaign_recipients').update({ status: 'failed', skip_reason: error instanceof Error ? error.message : String(error) }).eq('id', recipient.id).eq('status', 'pending');
    }
  }

  const nextStatus = campaign.requires_approval ? 'ready_for_review' : 'sending';
  await supabase.from('smart_campaigns').update({ status: nextStatus }).eq('id', campaignId);
  if (!campaign.requires_approval) {
    await supabase.from('smart_campaign_recipients').update({ status: 'approved' }).eq('campaign_id', campaignId).eq('status', 'generated');
    const { sendApprovedSmartRecipients } = await import('./delivery');
    await sendApprovedSmartRecipients({ campaignId, orgId });
  }
  return { campaignId, total: (recipients ?? []).length, generated, failed, status: nextStatus };
}

export async function approveSmartRecipient(campaignId: string, recipientId: string, orgId: string, editedMessage?: string) {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from('smart_campaign_recipients').update({
    status: 'approved',
    ...(editedMessage === undefined ? {} : { edited_message: editedMessage }),
  }).eq('id', recipientId).eq('campaign_id', campaignId).eq('status', 'generated').select().single();
  if (error || !data) throw new Error(`Получатель не найден или уже обработан: ${error?.message ?? ''}`);
  return data;
}

export async function approveAllSmartRecipients(campaignId: string) {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from('smart_campaign_recipients').update({ status: 'approved' }).eq('campaign_id', campaignId).eq('status', 'generated').select('id');
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

async function getLeadName(leadId: string): Promise<string> {
  const supabase = createServiceClient();
  const { data } = await supabase.from('leads').select('name').eq('id', leadId).maybeSingle();
  return normalizeString(data?.name) || 'клиент';
}

/**
 * Mark smart broadcast recipients as replied when lead responds to incoming message.
 * Called from webhooks (WhatsApp, Telegram) after lead sends a message.
 * Updates all recipients with status='sent' or 'sending' (to handle race condition)
 * that don't have replied_at set yet.
 * 
 * @param leadId - The lead ID responding to the broadcast
 * @param orgId - Organization ID (defense-in-depth: verify org ownership through campaign)
 * @returns Number of recipients marked as replied
 */
export async function markSmartBroadcastReplied(leadId: string, orgId: string): Promise<number> {
  const supabase = createServiceClient();
  return markSmartBroadcastRepliedWithClient(leadId, orgId, supabase);
}

export async function markSmartBroadcastRepliedWithClient(leadId: string, orgId: string, supabase: ReturnType<typeof createServiceClient>): Promise<number> {
  try {
    // Find all sent/sending recipients for this lead that don't have replied_at yet,
    // filtering via the related smart_campaigns row to enforce org ownership in one query.
    const { data: recipients, error: selectError } = await supabase
      .from('smart_campaign_recipients')
      .select('id, smart_campaigns!inner(id)')
      .eq('lead_id', leadId)
      .in('status', ['sent', 'sending'])
      .is('replied_at', null)
      .eq('smart_campaigns.org_id', orgId);

    if (selectError) {
      console.error('[smart-broadcast] Failed to query smart_campaign_recipients:', selectError);
      return 0;
    }

    if (!recipients || recipients.length === 0) {
      return 0;
    }

    const recipientIds = recipients.map((recipient) => recipient.id);

    // Update recipients to replied status.
    const { error: updateError, data: updatedRecipients } = await supabase
      .from('smart_campaign_recipients')
      .update({
        status: 'replied',
        replied_at: new Date().toISOString(),
      })
      .in('id', recipientIds)
      .select('id');

    if (updateError) {
      console.error('[smart-broadcast] Failed to mark recipients as replied:', updateError);
      return 0;
    }

    const count = (updatedRecipients ?? []).length;
    if (count > 0) {
      console.log(`[smart-broadcast] Marked ${count} recipient(s) as replied for lead ${leadId}`);
    }

    return count;
  } catch (error) {
    console.error('[smart-broadcast] Error in markSmartBroadcastReplied:', error);
    return 0;
  }
}
