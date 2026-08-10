 import { searchKnowledgeBaseWithLinks } from '@/lib/knowledge-base/search';
import { geminiCountTokens, GEMINI_CHAT_MODEL, GEMINI_PROMPT_MODEL } from '@/lib/server/ai/gemini-client';
import { llmClient, type LLMResponse } from './llm-client';
import { createAdminClient } from '@/lib/supabase/admin';
import { splitAgentMessage, calculateTypingDelay } from '@/lib/server/ai/message-splitter';
import { getEmptyResponseFallbackMessage, injectHandoffSection, normalizeHandoffConfig, type HandoffConfig } from '@/lib/server/ai/handoff';
import { sendTelegramNotification } from '@/lib/extensions/telegram-notify';
import { PRODUCTION_TOOL_DECLARATIONS, buildToolDeclarationsForAgent, mergeAllowedToolNames, type ToolCall } from '@/lib/ai/tools/registry';
import { executeTool, type ToolContext } from '@/lib/ai/tools/executor';
import { normalizeFunnelFlow } from '@/lib/funnel/normalize';
import { compileFlowToPrompt, getNodeInstructionText } from '@/lib/funnel/compile';
import { applyFunnelRouting, resolvePostRoutingReply, upsertLeadFunnelState } from '@/lib/funnel/routing';
import { buildConversationInsertData, buildSandboxConversationInsertData, buildSandboxLeadAttributes, isSandboxLeadAttributes } from '@/lib/ai/sandbox-context';
import { tryBuildDeterministicFactAnswer } from '@/lib/server/ai/deterministic-facts';
import { isValidLeadName } from '@/lib/server/lead-name';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface AgentMessagePart {
  text: string;
  delayMs: number;
}

export interface AgentTurnResult {
  answer: string;
  usedChunks: { id: string; similarity: number }[];
  messageParts: AgentMessagePart[];
  splitMessages: boolean;
  typingSimulation: boolean;
  handoffMessage?: string;
  toolsUsed?: string[];
  tokensInput?: number;
  tokensOutput?: number;
  latencyMs?: number;
  retrievalDebug?: {
    primaryChunks: Array<{ id: string; content: string; similarity: number; priority?: string; sourceTitle?: string; sourceType?: string; postType?: string }>;
    linkedChunks: Array<{ id: string; content: string; similarity: number; linkType?: string; priority?: string; sourceTitle?: string; sourceType?: string; postType?: string }>;
  };
}

export interface DialogueNodeExecutionResult {
  mode: 'script' | 'dynamic';
  messageParts?: AgentMessagePart[];
  finalAnswer?: string;
  warning?: string;
}

interface GeminiClientResponse {
  provider?: string;
  payload: {
    parts: Array<Record<string, unknown>>;
    finishReason?: string;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
  };
}

function trimToLastCompleteSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  const match = trimmed.match(/^[\s\S]*[.!?…]["')\]]?\s*/);
  return match ? match[0].trim() : trimmed;
}

function normalizeResponseParts(parts: Array<Record<string, unknown>> | undefined, finishReason?: string) {
  if (!Array.isArray(parts) || finishReason !== 'MAX_TOKENS') return parts ?? [];

  const text = parts
    .filter((part) => typeof part?.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();

  if (!text) return parts ?? [];

  const trimmedText = trimToLastCompleteSentence(text);
  return trimmedText === text ? (parts ?? []) : [{ text: trimmedText }];
}

export function getToolExecutionPolicy(toolName: string, toolUsageCounts: Record<string, number>) {
  const previousCalls = toolUsageCounts[toolName] ?? 0;
  if (previousCalls >= 1) {
    return {
      shouldExecute: false,
      reason: `${toolName} already used once in this turn`,
    };
  }

  return { shouldExecute: true };
}

export function buildToolFailureFallbackMessage(toolResults: Array<Record<string, unknown>>) {
  const failedResults = toolResults.filter((result) => Boolean(result.error));
  if (failedResults.length === 0) {
    return null;
  }

  const failedToolNames = failedResults
    .map((result) => (typeof result.name === 'string' ? result.name : ''))
    .filter(Boolean);

  if (failedToolNames.includes('searchKnowledgeBase') && failedToolNames.length === 1) {
    return null;
  }

  if (failedToolNames.includes('createKaspiInvoice')) {
    return 'Счёт сейчас не получается оформить автоматически. Уточню данные и сразу напишу.';
  }

  return 'Не удалось выполнить действие автоматически. Уточню детали и сразу напишу.';
}

const AGENT_CACHE_TTL_MS = 5_000;
const agentCache = new Map<string, { expiresAt: number; data: Record<string, unknown> | null }>();
const contextCache = new Map<string, { data: unknown; expiresAt: number }>();
const CONTEXT_CACHE_TTL_MS = 10_000;

async function getCachedAgent(
  admin: ReturnType<typeof createAdminClient>,
  agentId: string,
  select: string,
) {
  const now = Date.now();
  const cached = agentCache.get(agentId);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const { data, error } = await admin.from('agents').select(select).eq('id', agentId).single();
  const resolvedData = error ? null : (data as unknown as Record<string, unknown> | null);
  agentCache.set(agentId, { expiresAt: now + AGENT_CACHE_TTL_MS, data: resolvedData });
  return resolvedData;
}

function tryBuildDeterministicFactAnswerWithLogging(
  message: string,
  chunks: Array<{ content?: string; similarity?: number }> = [],
  leadGrade?: string | number | null,
): string | null {
  console.log('[FACT_DEBUG] evaluating deterministic answer', { message, chunkCount: chunks.length, sample: chunks[0]?.content?.slice(0, 120) });
  return tryBuildDeterministicFactAnswer(message, chunks, leadGrade);
}
// Helper: Find dialogue node by ID in funnel flow
function getDialogueNode(flow: ReturnType<typeof normalizeFunnelFlow> | null | undefined, nodeId: string | null) {
  if (!flow || !nodeId) return null;
  return flow.nodes?.find((node) => node.id === nodeId) ?? null;
}

function extractLegacyScriptText(node: { content?: string | null; message_type?: string | null; script_parts?: string[] | null } | null | undefined): string | null {
  const content = typeof node?.content === 'string' ? node.content.trim() : '';
  if (!content) return null;

  const directReplyPatterns = [
    /(?:отправь клиенту текст|отправь клиенту|send client text|reply with|отправить клиенту)\s*[:\-]?\s*["“]([^"”]+)["”]/i,
    /(?:отправь клиенту текст|отправь клиенту|send client text|reply with|отправить клиенту)\s*[:\-]?\s*([^\n\r]+)/i,
  ];

  for (const pattern of directReplyPatterns) {
    const match = content.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

// Helper: Convert script_parts array to AgentMessagePart[] with typing delays
export function handleScriptMessageParts(
  scriptParts: string[] | undefined,
  typingSimulationEnabled: boolean,
): AgentMessagePart[] {
  if (!Array.isArray(scriptParts) || scriptParts.length === 0) {
    return [];
  }

  const parts: AgentMessagePart[] = scriptParts
    .filter((part) => typeof part === 'string' && part.trim())
    .map((text) => {
      const delay = typingSimulationEnabled ? calculateTypingDelay(text) : 0;
      return {
        text,
        delayMs: delay,
      };
    });

  return parts;
}
export async function resolveDialogueNodeExecution(
  flow: ReturnType<typeof normalizeFunnelFlow> | null | undefined,
  nodeId: string | null,
  typingSimulationEnabled: boolean,
  options?: { callGemini?: () => Promise<unknown> },
): Promise<DialogueNodeExecutionResult> {
  const currentDialogueNode = getDialogueNode(flow, nodeId);
  const legacyScriptText = extractLegacyScriptText(currentDialogueNode);
  const hasScriptParts = Array.isArray(currentDialogueNode?.script_parts) && currentDialogueNode.script_parts.length > 0;
  const isScriptLikeNode = currentDialogueNode?.message_type === 'script' || hasScriptParts || Boolean(legacyScriptText);

  if (isScriptLikeNode) {
    const scriptParts = hasScriptParts
      ? currentDialogueNode!.script_parts!
      : (legacyScriptText ? [legacyScriptText] : []);

    if (scriptParts.length > 0) {
      const messageParts = handleScriptMessageParts(scriptParts, typingSimulationEnabled);
      const finalAnswer = messageParts.map((part) => part.text).join('\n\n');
      return {
        mode: 'script',
        messageParts,
        finalAnswer,
      };
    }

    const warning = `[SCRIPT_PATH] Node ${nodeId} is marked as script but has empty script_parts; falling back to dynamic behavior`;
    console.warn(warning);
    if (typeof options?.callGemini === 'function') {
      await options.callGemini();
    }
    return {
      mode: 'dynamic',
      warning,
    };
  }

  if (typeof options?.callGemini === 'function') {
    await options.callGemini();
  }

  return {
    mode: 'dynamic',
  };
}
// === End Script Path helpers ===

export function shouldRenderScriptMessage({
  shouldRoutePendingReply,
  nodeExecutionMode,
  finalAnswer,
}: {
  shouldRoutePendingReply: boolean;
  nodeExecutionMode: DialogueNodeExecutionResult['mode'];
  finalAnswer?: string | null;
}) {
  return !shouldRoutePendingReply && nodeExecutionMode === 'script' && Boolean(finalAnswer);
}

export async function handleScriptNodeTurn({
  admin,
  agentId,
  leadId,
  conversationId,
  flow,
  currentFunnelStep,
  pendingScriptNodeId,
  pendingScriptReply,
  userMessage,
  routeExecutor = applyFunnelRouting,
  sendScriptImpl,
}: {
  admin: ReturnType<typeof createAdminClient>;
  agentId: string;
  leadId: string | null;
  conversationId: string | null;
  flow: ReturnType<typeof normalizeFunnelFlow> | null;
  currentFunnelStep: string | null;
  pendingScriptNodeId: string | null;
  pendingScriptReply: string | null;
  userMessage: string;
  routeExecutor?: typeof applyFunnelRouting;
  sendScriptImpl?: () => Promise<void> | void;
}) {
  const shouldRoutePendingScriptReply = Boolean(currentFunnelStep && pendingScriptNodeId && pendingScriptNodeId === currentFunnelStep);

  if (shouldRoutePendingScriptReply) {
    const routingOutcome = await routeExecutor({
      admin,
      agentId,
      leadId,
      conversationId,
      flow,
      currentNodeId: currentFunnelStep,
      userMessage,
      assistantReply: pendingScriptReply ?? '',
      executeToolImpl: undefined,
    } as Parameters<typeof applyFunnelRouting>[0]);

    return {
      shouldSendScript: false,
      shouldRoutePendingReply: true,
      currentFunnelStep: routingOutcome.targetNodeId ?? currentFunnelStep,
      routingOutcome,
    };
  }

  if (typeof sendScriptImpl === 'function') {
    await sendScriptImpl();
  }

  return {
    shouldSendScript: true,
    shouldRoutePendingReply: false,
    currentFunnelStep,
  };
}

interface ToolCallRequest {
  name: string;
  args: Record<string, unknown>;
}

async function readAgentCapabilities(admin: ReturnType<typeof createAdminClient>, agentId: string) {
  const agentData = await getCachedAgent(admin, agentId, 'general_capabilities') as { general_capabilities?: Record<string, unknown> | null } | null;

  return normalizeHandoffConfig((agentData?.general_capabilities as Record<string, unknown> | null)?.handoff_config);
}

function getEntryNodeId(flow: ReturnType<typeof normalizeFunnelFlow>): string | null {
  return flow?.entryNodeId ? flow.entryNodeId : null;
}

async function alertLeadContextError(admin: ReturnType<typeof createAdminClient>, params: {
  agentId: string;
  orgId: string | null;
  externalLeadId?: string | null;
  preferRealLead?: boolean;
  conversationId?: string | null;
  leadId?: string | null;
  userMessage?: string | null;
  reason: string;
}) {
  const payload = {
    event: 'lead_context_error',
    agentId: params.agentId,
    orgId: params.orgId,
    externalLeadId: params.externalLeadId ?? null,
    preferRealLead: params.preferRealLead ?? false,
    conversationId: params.conversationId ?? null,
    leadId: params.leadId ?? null,
    userMessage: params.userMessage ?? null,
    reason: params.reason,
  };

  console.error('[ORCHESTRATOR_ALERT] lead context error', payload);

  try {
    await admin.from('notification_log').insert({
      org_id: params.orgId,
      agent_id: params.agentId,
      lead_id: params.leadId,
      event_type: 'lead_context_error',
      payload,
      delivery_status: 'pending',
    });
  } catch (notificationError) {
    console.error('[ORCHESTRATOR_ALERT] failed to persist lead context alert', { payload, notificationError });
  }
}

export type LeadContextMode = 'real' | 'sandbox' | 'error';

export function resolveLeadContextMode(externalLeadId: string | null | undefined, preferRealLead = false): LeadContextMode {
  if (externalLeadId) {
    return 'real';
  }

  if (preferRealLead) {
    return 'error';
  }

  return 'sandbox';
}

async function ensureLeadContext(
  admin: ReturnType<typeof createAdminClient>,
  agentId: string,
  userMessage: string,
  externalLeadId?: string,
  existingUserMessageId?: string,
  options?: { preferRealLead?: boolean },
) {
  const agentData = await getCachedAgent(admin, agentId, 'org_id, dialogue_flow') as { org_id?: string | null; dialogue_flow?: unknown } | null;

  if (!agentData?.org_id) {
    return {
      leadId: null,
      conversationId: null,
      orgId: null,
      leadAttributes: null,
      previousConversationSummary: null,
      userMessageId: null,
      isSandbox: false,
    };
  }

  const findLeadAttributes = async (leadId: string) => {
    const { data: leadRow } = await admin
      .from('leads')
      .select('attributes')
      .eq('id', leadId)
      .single();

    return (leadRow?.attributes as Record<string, unknown> | null) ?? null;
  };

  const findPreviousConversationSummary = async (leadId: string) => {
    const { data: conversations } = await admin
      .from('conversations')
      .select('id, summary')
      .eq('lead_id', leadId)
      .eq('agent_id', agentId)
      .order('started_at', { ascending: false })
      .limit(2);

    return Array.isArray(conversations) && conversations.length > 1
      ? conversations[1]?.summary ?? null
      : null;
  };

  const leadContextMode = resolveLeadContextMode(externalLeadId, options?.preferRealLead);

  if (leadContextMode === 'error') {
    await alertLeadContextError(admin, {
      agentId,
      orgId: agentData.org_id,
      externalLeadId,
      preferRealLead: options?.preferRealLead,
      conversationId: null,
      leadId: null,
      userMessage,
      reason: 'missing_external_lead_id_for_real_context',
    });
    return {
      leadId: null,
      conversationId: null,
      orgId: agentData.org_id,
      leadAttributes: null,
      previousConversationSummary: null,
      userMessageId: null,
      isSandbox: false,
    };
  }

  if (leadContextMode === 'real') {
    if (!externalLeadId) {
      await alertLeadContextError(admin, {
        agentId,
        orgId: agentData.org_id,
        externalLeadId,
        preferRealLead: options?.preferRealLead,
        conversationId: null,
        leadId: null,
        userMessage,
        reason: 'missing_external_lead_id_for_real_context',
      });
      return {
        leadId: null,
        conversationId: null,
        orgId: agentData.org_id,
        leadAttributes: null,
        previousConversationSummary: null,
        userMessageId: null,
        isSandbox: false,
      };
    }

    const { data: existingLead } = await admin
      .from('leads')
      .select('id')
      .eq('id', externalLeadId)
      .single();

    if (!existingLead) {
      console.warn(`[orchestrator] External lead not found: ${externalLeadId}`);
      return {
        leadId: null,
        conversationId: null,
        orgId: agentData.org_id,
        leadAttributes: null,
        previousConversationSummary: null,
        userMessageId: null,
        isSandbox: false,
      };
    }

    let { data: conversation } = await admin
      .from('conversations')
      .select('id')
      .eq('lead_id', externalLeadId)
      .eq('agent_id', agentId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conversation) {
      const entryNodeId = getEntryNodeId(normalizeFunnelFlow(agentData?.dialogue_flow));
      const { data: createdConversation } = await admin
        .from('conversations')
        .insert(buildConversationInsertData({
          lead_id: externalLeadId,
          agent_id: agentId,
          ...(entryNodeId ? { current_funnel_step: entryNodeId } : {}),
        }))
        .select('id')
        .single();
      conversation = createdConversation;
    }

    const insertedMessage = existingUserMessageId
      ? { data: { id: existingUserMessageId } }
      : conversation?.id
        ? await admin.from('messages').insert({
            conversation_id: conversation.id,
            sender: 'user',
            content: userMessage,
          }).select('id').single()
        : null;

    return {
      leadId: externalLeadId,
      conversationId: conversation?.id ?? null,
      orgId: agentData.org_id,
      leadAttributes: conversation?.id ? await findLeadAttributes(externalLeadId) : null,
      previousConversationSummary: externalLeadId ? await findPreviousConversationSummary(externalLeadId) : null,
      userMessageId: insertedMessage?.data?.id ?? null,
      isSandbox: false,
    };
  }

  const externalId = `sandbox:${agentId}`;
  const { data: leadLookup } = await admin
    .from('leads')
    .select('id, attributes')
    .eq('org_id', agentData.org_id)
    .eq('external_id', externalId)
    .maybeSingle();

  let lead = leadLookup as { id?: string; attributes?: Record<string, unknown> | null } | null;
  let conversation: { id?: string } | null = null;

  if (lead?.id) {
    const { data: existingConversation } = await admin
      .from('conversations')
      .select('id')
      .eq('lead_id', lead.id)
      .eq('agent_id', agentId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    conversation = existingConversation as { id?: string } | null;
  }

  if (!lead) {
    const { data: createdLead } = await admin
      .from('leads')
      .insert({
        org_id: agentData.org_id,
        external_id: externalId,
        name: 'Sandbox lead',
        ai_enabled: true,
        attributes: buildSandboxLeadAttributes(),
      })
      .select('id, attributes')
      .single();
    lead = createdLead as { id?: string; attributes?: Record<string, unknown> | null } | null;
  }

  if (lead?.id && !isSandboxLeadAttributes((lead.attributes as Record<string, unknown> | null) ?? null)) {
    await admin.from('leads').update({ attributes: buildSandboxLeadAttributes(lead.attributes as Record<string, unknown> | null) }).eq('id', lead.id);
  }

  if (!lead?.id) {
    return {
      leadId: null,
      conversationId: null,
      orgId: agentData.org_id,
      leadAttributes: null,
      previousConversationSummary: null,
      userMessageId: null,
      isSandbox: true,
    };
  }

  const existingConversation = conversation as { id?: string } | null;
  let resolvedConversation = existingConversation;
  if (!resolvedConversation) {
    const entryNodeId = getEntryNodeId(normalizeFunnelFlow(agentData?.dialogue_flow));
    const { data: createdConversation } = await admin
      .from('conversations')
      .insert(buildSandboxConversationInsertData({
        lead_id: lead.id,
        agent_id: agentId,
        ...(entryNodeId ? { current_funnel_step: entryNodeId } : {}),
      }))
      .select('id')
      .single();
    resolvedConversation = createdConversation as { id?: string } | null;
  }

  const insertedMessage = resolvedConversation?.id
    ? await admin.from('messages').insert({
        conversation_id: resolvedConversation.id,
        sender: 'user',
        content: userMessage,
      }).select('id').single()
    : null;

  return {
    leadId: lead.id,
    conversationId: resolvedConversation?.id ?? null,
    orgId: agentData.org_id,
    leadAttributes: lead.id ? await findLeadAttributes(lead.id) : null,
    previousConversationSummary: lead.id ? await findPreviousConversationSummary(lead.id) : null,
    userMessageId: insertedMessage?.data?.id ?? null,
    isSandbox: true,
  };
}

async function appendMessage(admin: ReturnType<typeof createAdminClient>, conversationId: string | null, sender: 'ai' | 'system', content: string) {
  if (!conversationId) return;

  await admin.from('messages').insert({
    conversation_id: conversationId,
    sender,
    content,
  });
}

export function buildFunnelStepInstruction(currentFunnelStep: string | null | undefined): string {
  if (!currentFunnelStep) return '';

  return `\n\nТы сейчас на шаге "${currentFunnelStep}". После ответа система автоматически определит следующий шаг воронки по текущему контексту. Не пытайся вручную переключать шаги через инструменты — просто продолжай диалог в рамках текущего шага. Для перехода к следующему шагу используй advanceFunnelStep.`;
}

export async function applyRoutingAndFinalizeReply({
  admin,
  agentId,
  leadId,
  conversationId,
  flow,
  currentFunnelStep,
  userMessage,
  finalAnswer,
  handoffConfig,
  executeToolImpl,
}: {
  admin: ReturnType<typeof createAdminClient>;
  agentId: string;
  leadId: string | null;
  conversationId: string | null;
  flow: ReturnType<typeof normalizeFunnelFlow> | null;
  currentFunnelStep: string | null;
  userMessage: string;
  finalAnswer: string;
  handoffConfig: HandoffConfig;
  executeToolImpl?: (call: { name: string; args: Record<string, unknown> }, context: ToolContext) => Promise<unknown>;
}): Promise<{ finalAnswer: string; shouldAppendMessage: boolean; handoffTriggered: boolean; routingOutcome: Awaited<ReturnType<typeof applyFunnelRouting>> }> {
  const routingOutcome = await applyFunnelRouting({
    admin,
    agentId,
    leadId,
    conversationId,
    flow,
    currentNodeId: currentFunnelStep,
    userMessage,
    assistantReply: finalAnswer,
    executeToolImpl,
  });

  const postRoutingReply = resolvePostRoutingReply({
    routingOutcome,
    finalAnswer,
    handoffClientMessage: handoffConfig.client_message,
  });

  return {
    finalAnswer: postRoutingReply.finalAnswer,
    shouldAppendMessage: postRoutingReply.shouldAppendMessage,
    handoffTriggered: routingOutcome.shouldHandoff,
    routingOutcome,
  };
}

async function executeRedirectToOperator(
  admin: ReturnType<typeof createAdminClient>,
  agentId: string,
  leadId: string | null,
  conversationId: string | null,
  reason: string,
  handoffConfig: HandoffConfig,
) {
  const normalizedReason = reason?.trim() || 'Передача оператору';

  if (leadId) {
    await admin.from('leads').update({ ai_enabled: false }).eq('id', leadId);
    await admin.from('lead_notes').insert({
      lead_id: leadId,
      note: `Авто-передача оператору: ${normalizedReason}`,
    });
  }

  const handoffMessage = 'Разговор передан оператору';
  const clientMessage = handoffConfig.client_message?.trim() || 'Подключаю сотрудника, он уже видит наш диалог';

  if (conversationId) {
    await appendMessage(admin, conversationId, 'system', handoffMessage);
    await appendMessage(admin, conversationId, 'ai', clientMessage);
  }

  try {
    const { data: settingsRow } = await admin
      .from('extension_settings')
      .select('config')
      .eq('agent_id', agentId)
      .eq('extension_type', 'telegram_notifications')
      .maybeSingle();

    const config = (settingsRow?.config as { recipients?: string[]; events?: { operator_needed?: { enabled?: boolean } } } | null) ?? {};
    const isEnabled = config.events?.operator_needed?.enabled !== false;
    const recipientIds = Array.isArray(config.recipients) ? config.recipients : [];

    if (isEnabled && recipientIds.length) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('telegram_chat_id')
        .in('id', recipientIds);

      for (const profile of profiles ?? []) {
        if (profile.telegram_chat_id) {
          await sendTelegramNotification(
            profile.telegram_chat_id,
            `🔔 Лид запросил оператора. Причина: ${normalizedReason}`
          );
        }
      }
    }
  } catch (error) {
    console.error('[orchestrator] failed to send Telegram handoff notification', error);
  }

  return {
    answer: clientMessage,
    handoffMessage,
  };
}

function tryExtractToolCalls(parts: Array<Record<string, any>> | undefined): ToolCallRequest[] {
  if (!Array.isArray(parts)) return [];

  return parts
    .filter((part) => part?.functionCall?.name)
    .map((part) => ({
      name: part.functionCall.name,
      args: part.functionCall.args ?? {},
    }));
}

function normalizeLlmResponseParts(response: any): Array<Record<string, unknown>> {
  const llmToolCalls = (response as any).toolCalls ?? [];
  const llmParts: Array<Record<string, unknown>> = [];

  if (typeof response?.text === 'string' && response.text.trim().length > 0) {
    llmParts.push({ text: response.text });
  }

  for (const tc of llmToolCalls) {
    if (!tc || typeof tc !== 'object') continue;
    llmParts.push({
      functionCall: {
        name: tc.name,
        args: tc.arguments ?? tc.args ?? {},
      },
    });
  }

  if (llmParts.length > 0) {
    return llmParts;
  }

  if (Array.isArray(response?.payload?.parts)) {
    return response.payload.parts as Array<Record<string, unknown>>;
  }

  if (typeof response?.text === 'string') {
    return [{ text: response.text }];
  }

  return [];
}

function extractTextFromParts(parts: Array<Record<string, unknown>> | undefined): string {
  if (!Array.isArray(parts)) return '';

  return parts
    .filter((part) => typeof part?.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

const SUMMARY_TOKEN_THRESHOLD = Infinity;
const SUMMARY_TAIL_MESSAGES = 30;

function serializeMessagesForSummary(messages: Array<{ role: 'user' | 'model'; text: string }>) {
  return messages
    .map((message) => `${message.role === 'user' ? 'Клиент' : 'Агент'}: ${message.text}`)
    .join('\n');
}

function serializeContentForTokenCount(
  summary: string | null | undefined,
  messages: Array<{ id: string; role: 'user' | 'model'; text: string }>,
) {
  const contents: Array<Record<string, unknown>> = [];
  if (summary) {
    contents.push({ role: 'user', parts: [{ text: summary }] });
  }
  for (const message of messages) {
    contents.push({ role: message.role, parts: [{ text: message.text }] });
  }
  return contents;
}

async function estimateContentTokens(
  contents: Array<Record<string, unknown>>,
): Promise<{ tokens: number; fallback: boolean }> {
  try {
    const tokens = await geminiCountTokens(GEMINI_CHAT_MODEL, contents);
    console.log(`[orchestrator] countTokens returned ${tokens} tokens for conversation context`);
    return { tokens, fallback: false };
  } catch (error) {
    const fallbackTokens = Math.max(0, Math.ceil(JSON.stringify(contents).length / 2.5));
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(
      `[orchestrator] Gemini countTokens failed, using fallback estimate ${fallbackTokens} tokens. Error: ${errorMessage}`,
    );
    return { tokens: fallbackTokens, fallback: true };
  }
}

async function loadConversationMessages(
  admin: ReturnType<typeof createAdminClient>,
  conversationId: string,
  excludeMessageId?: string | null,
  limit = 30,
) {
  let query = admin
    .from('messages')
    .select('id, sender, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (excludeMessageId) {
    query = query.neq('id', excludeMessageId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load conversation messages: ${error.message}`);
  }

  return ((data as Array<{ id: string; sender: string | null; content: string | null }> | null) ?? []).reverse();
}

async function getCachedConversationContext(
  admin: ReturnType<typeof createAdminClient>,
  conversationId: string,
  excludeMessageId?: string | null,
) {
  const key = `${conversationId}:${excludeMessageId ?? 'none'}`;
  const cached = contextCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as Awaited<ReturnType<typeof buildConversationContext>>;
  }

  const data = await buildConversationContext(admin, conversationId, excludeMessageId);
  contextCache.set(key, { data, expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS });
  return data;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

async function callGemini(
  modelName: string,
  systemPrompt: string,
  contents: Array<Record<string, unknown>>,
  tools: Array<Record<string, unknown>>,
  previousToolCalls?: Array<Record<string, unknown>>,
  generationConfig: Record<string, unknown> = {
    temperature: 0.7,
    topP: 0.9,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  },
  retryCount = 0,
): Promise<GeminiClientResponse> {
  const fallbackModel = 'gemini-2.5-flash';

  async function execute(activeModel: string): Promise<GeminiClientResponse> {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...(contents.map((content) => ({
        role: content.role === 'model' ? 'assistant' : (content.role as 'user' | 'assistant'),
        content: Array.isArray(content.parts)
          ? content.parts.map((part) => (typeof part?.text === 'string' ? part.text : '')).filter(Boolean).join('\n')
          : '',
      })) as any[]),
    ];

    console.error('[FC-DEBUG] outgoing messages:', JSON.stringify(messages, null, 2));

    let llmResponse = await llmClient.generate({
      model: activeModel,
      messages,
      temperature: (generationConfig as any)?.temperature ?? 0.7,
      maxTokens: (generationConfig as any)?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      tools: Array.isArray(tools) && tools.length > 0 ? tools : undefined,
    });

    const hasLlmText = typeof llmResponse.text === 'string' && llmResponse.text.trim().length > 0;
    const hasLlmToolCalls = Array.isArray(llmResponse.toolCalls) && llmResponse.toolCalls.length > 0;
    if (llmResponse.provider === 'gemini' && !hasLlmText && !hasLlmToolCalls) {
      const fallbackModel = process.env.FALLBACK_LLM_MODEL ?? 'gpt-5.4-mini';
      console.warn('[GEMINI] empty reply from Gemini provider, trying fallback LLM', { activeModel, fallbackModel });
      try {
        const fallbackResponse = await llmClient.generate({
          model: fallbackModel,
          messages,
          temperature: (generationConfig as any)?.temperature ?? 0.7,
          maxTokens: (generationConfig as any)?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          tools: Array.isArray(tools) && tools.length > 0 ? tools : undefined,
        });

        const fallbackHasText = typeof fallbackResponse.text === 'string' && fallbackResponse.text.trim().length > 0;
        const fallbackHasToolCalls = Array.isArray(fallbackResponse.toolCalls) && fallbackResponse.toolCalls.length > 0;
        if (fallbackHasText || fallbackHasToolCalls) {
          console.warn('[GEMINI] fallback LLM succeeded', { provider: fallbackResponse.provider });
          llmResponse = fallbackResponse;
        } else {
          console.warn('[GEMINI] fallback LLM returned empty response too', { provider: fallbackResponse.provider });
        }
      } catch (fallbackError) {
        console.warn('[GEMINI] fallback LLM failed', {
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
      }
    }

    const parts: Array<Record<string, unknown>> = [];
    if (typeof llmResponse.text === 'string' && llmResponse.text.trim().length > 0) {
      parts.push({ text: llmResponse.text });
    }
    if (Array.isArray(llmResponse.toolCalls) && llmResponse.toolCalls.length > 0) {
      for (const toolCall of llmResponse.toolCalls) {
        parts.push({ functionCall: { name: toolCall.name, args: toolCall.args } });
      }
    }
    const usageMetadata = llmResponse.usage ?? ({ } as Record<string, unknown>);
    const finishReason = llmResponse.finishReason;
    const normalizedParts = normalizeResponseParts(parts, finishReason);

    if (finishReason === 'MAX_TOKENS' && retryCount === 0) {
      const currentMax = (generationConfig as any)?.maxOutputTokens ?? 512;
      const cap = 32768;
      if (currentMax < cap) {
        const nextMax = Math.min(cap, Math.max(currentMax * 2, currentMax + 1024));
        const newGen = { ...(generationConfig as any), maxOutputTokens: nextMax };
        return callGemini(modelName, systemPrompt, contents, tools, previousToolCalls, newGen, 1);
      }
      return {
        provider: llmResponse.provider ?? 'gemini',
        payload: {
          parts: normalizedParts,
          finishReason,
          usageMetadata: {
            promptTokenCount: Number((usageMetadata as any)?.promptTokenCount ?? (usageMetadata as any)?.prompt_tokens ?? 0),
            candidatesTokenCount: Number((usageMetadata as any)?.candidatesTokenCount ?? (usageMetadata as any)?.candidates_tokens ?? 0),
          },
        },
      };
    }

    return {
      provider: llmResponse.provider ?? 'gemini',
      payload: {
        parts: normalizedParts,
        finishReason,
        usageMetadata: {
          promptTokenCount: Number((usageMetadata as any)?.promptTokenCount ?? (usageMetadata as any)?.prompt_tokens ?? 0),
          candidatesTokenCount: Number((usageMetadata as any)?.candidatesTokenCount ?? (usageMetadata as any)?.candidates_tokens ?? 0),
        },
      },
    };
  }

  try {
    return await execute(modelName);
  } catch (err: any) {
    const errorText = `${err?.message ?? ''} ${err?.status ?? ''}`.toLowerCase();
    const shouldFallback = modelName !== fallbackModel && (err?.status === 404 || /model not found|deprecated|not supported|does not support/i.test(errorText));
    if (!shouldFallback) {
      throw err;
    }

    console.warn('[GEMINI] Model deprecated/not found:', modelName, '— falling back to gemini-2.5-flash');
    try {
      return await execute(fallbackModel);
    } catch (fallbackErr: any) {
      const fallbackMessage = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      throw new Error(fallbackMessage);
    }
  }
}

async function summarizeConversationSegment(
  admin: ReturnType<typeof createAdminClient>,
  conversationId: string,
  previousSummary: string | null,
  messagesToCompress: Array<{ id: string; role: 'user' | 'model'; text: string }>,
) {
  const summaryPrompt = `Ты помощник, который сжимает историю диалога для AI-агента.
Сохрани ключевые факты о клиенте, что обсуждалось, на что он возражал или просил, и текущий этап разговора.
Верни только компактное резюме, без новых выводов и без повторения полного текста сообщений.

${previousSummary ? `Предыдущее резюме:
${previousSummary}

` : ''}Сжимаемая часть диалога:
${serializeMessagesForSummary(messagesToCompress)}\n`;

  const start = Date.now();
  const res = await callGemini(
    GEMINI_PROMPT_MODEL,
    summaryPrompt,
    [{ role: 'user', parts: [{ text: summaryPrompt }] }],
    [],
    undefined,
    { temperature: 0.2, topP: 0.25, maxOutputTokens: 1024 },
  );

  const summaryText = extractTextFromParts(res.payload.parts);
  const latencyMs = Date.now() - start;
  const tokensInput = res.payload.usageMetadata?.promptTokenCount ?? 0;
  const tokensOutput = res.payload.usageMetadata?.candidatesTokenCount ?? 0;

  await admin.from('ai_call_logs').insert({
    conversation_id: conversationId,
    request: {
      type: 'summary',
      model: GEMINI_PROMPT_MODEL,
      prompt: summaryPrompt,
      messages_compressed: messagesToCompress.length,
      previous_summary_exists: Boolean(previousSummary),
    },
    response: {
      summary: summaryText,
      raw_parts: res.payload.parts,
    },
    tokens_input: tokensInput,
    tokens_output: tokensOutput,
    latency_ms: latencyMs,
  });

  await admin.from('conversations').update({
    summary: summaryText,
    summary_up_to_message_id: messagesToCompress.length > 0 ? messagesToCompress[messagesToCompress.length - 1].id : null,
  }).eq('id', conversationId);

  return {
    summaryText,
    summaryUpToMessageId: messagesToCompress.length > 0 ? messagesToCompress[messagesToCompress.length - 1].id : null,
  };
}

async function buildConversationContext(
  admin: ReturnType<typeof createAdminClient>,
  conversationId: string,
  excludeMessageId?: string | null,
) {
  const { data: conversation } = await admin
    .from('conversations')
    .select('summary, summary_up_to_message_id')
    .eq('id', conversationId)
    .single();

  const allMessages = await loadConversationMessages(admin, conversationId, excludeMessageId);

  const summaryUpToMessageId = conversation?.summary_up_to_message_id ?? null;
  let messagesAfterSummary = allMessages;
  if (summaryUpToMessageId) {
    const boundaryIndex = allMessages.findIndex((item) => item.id === summaryUpToMessageId);
    if (boundaryIndex >= 0) {
      messagesAfterSummary = allMessages.slice(boundaryIndex + 1);
    }
  }

  const formattedMessages = messagesAfterSummary
    .filter((message) => message.content && message.content.trim())
    .map((message) => ({
      id: message.id,
      role: (message.sender === 'user' ? 'user' : 'model') as 'user' | 'model',
      text: message.content!.trim(),
    }));

  const recentMessages = formattedMessages.slice(-10);
  const tokenContents = serializeContentForTokenCount(conversation?.summary, recentMessages);
  const { tokens: totalTokens, fallback: tokenEstimateFallback } = await estimateContentTokens(tokenContents);
  if (totalTokens <= SUMMARY_TOKEN_THRESHOLD) {
    return {
      conversationSummary: conversation?.summary ?? null,
      messagesAfterSummary: recentMessages,
      summaryUpToMessageId,
      contextTokenCount: totalTokens,
      contextTokenCountFallback: tokenEstimateFallback,
    };
  }

  const compressibleCount = Math.max(1, formattedMessages.length - SUMMARY_TAIL_MESSAGES);
  const messagesToCompress = formattedMessages.slice(0, compressibleCount);
  const tailMessages = formattedMessages.slice(compressibleCount);
  const recentTailMessages = tailMessages.slice(-10);

  if (messagesToCompress.length === 0) {
    return {
      conversationSummary: conversation?.summary ?? null,
      messagesAfterSummary: recentMessages,
      summaryUpToMessageId,
      contextTokenCount: totalTokens,
      contextTokenCountFallback: tokenEstimateFallback,
    };
  }

  const { summaryText, summaryUpToMessageId: updatedSummaryId } = await summarizeConversationSegment(
    admin,
    conversationId,
    conversation?.summary ?? null,
    messagesToCompress,
  );

  return {
    conversationSummary: summaryText,
    messagesAfterSummary: recentTailMessages,
    summaryUpToMessageId: updatedSummaryId,
    contextTokenCount: totalTokens,
    contextTokenCountFallback: tokenEstimateFallback,
  };
}

export async function runAgentTurnWithLead(
  agentId: string,
  systemPrompt: string,
  userMessage: string,
  history: ChatMessage[] = [],
  externalLeadId: string,
  userMessageId?: string,
  options?: { preferRealLead?: boolean },
): Promise<AgentTurnResult> {
  const admin = createAdminClient();
  let resolvedLeadId: string | null = externalLeadId ?? null;
  let resolvedConversationId: string | null = null;
  let resolvedUserMessageId: string | undefined = userMessageId;

  if (resolvedLeadId) {
    const { data: lead } = await admin.from('leads').select('id').eq('id', resolvedLeadId).maybeSingle();
    if (lead?.id) {
      let { data: conversation } = await admin
        .from('conversations')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('agent_id', agentId)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!conversation) {
        const entryNodeId = getEntryNodeId(normalizeFunnelFlow(((await getCachedAgent(admin, agentId, 'dialogue_flow')) as { dialogue_flow?: unknown } | null)?.dialogue_flow));
        const { data: createdConversation } = await admin
          .from('conversations')
          .insert(buildConversationInsertData({
            lead_id: lead.id,
            agent_id: agentId,
            ...(entryNodeId ? { current_funnel_step: entryNodeId } : {}),
          }))
          .select('id')
          .single();
        conversation = createdConversation;
      }

      resolvedConversationId = conversation?.id ?? null;
      if (!resolvedUserMessageId && resolvedConversationId) {
        const { data: insertedMessage } = await admin.from('messages').insert({
          conversation_id: resolvedConversationId,
          sender: 'user',
          content: userMessage,
        }).select('id').single();
        resolvedUserMessageId = insertedMessage?.id ?? undefined;
      }
    }
  }

  return runAgentTurn(agentId, systemPrompt, userMessage, history, resolvedLeadId ?? undefined, resolvedConversationId ?? undefined, resolvedUserMessageId);
}

export async function runAgentTurn(
  agentId: string,
  systemPrompt: string,
  userMessage: string,
  history: ChatMessage[] = [],
  leadId?: string,
  conversationId?: string,
  userMessageId?: string,
): Promise<AgentTurnResult> {
  const admin = createAdminClient();
  const startTime = Date.now();
  const handoffConfig = await readAgentCapabilities(admin, agentId);
  const basePrompt = injectHandoffSection(systemPrompt, handoffConfig);

  // Читаем allowed_tools конкретного агента
  const agentData = await getCachedAgent(admin, agentId, 'general_capabilities, dialogue_flow') as { general_capabilities?: Record<string, unknown> | null; dialogue_flow?: unknown } | null;

  const generalCapabilities = (agentData?.general_capabilities as Record<string, unknown> | null) ?? {};
  const configuredToolNames = Array.isArray(generalCapabilities.allowed_tools)
    ? (generalCapabilities.allowed_tools as string[]).filter((name) => typeof name === 'string')
    : [];
  const allowedToolNames = configuredToolNames.length > 0
    ? mergeAllowedToolNames(configuredToolNames, [])
    : [];

  // Формируем toolDeclarations только для разрешённых тулов
  const toolDeclarations = buildToolDeclarationsForAgent(allowedToolNames, generalCapabilities, agentData?.dialogue_flow);
  const toolPayload = toolDeclarations.length > 0 ? (toolDeclarations as unknown as Array<Record<string, unknown>>) : [];
  console.log(`[AGENT_TOOLS] Agent ${agentId}: allowed tools: [${allowedToolNames.join(', ')}], declarations: [${toolDeclarations.map((d) => d.name).join(', ')}]`);

  let resolvedLeadId: string | null = leadId ?? null;
  let resolvedConversationId: string | null = conversationId ?? null;
  let resolvedUserMessageId: string | null = userMessageId ?? null;

  const [contextData, retrieval] = await Promise.all([
    ensureLeadContext(admin, agentId, userMessage, resolvedLeadId ?? undefined, resolvedUserMessageId ?? undefined),
    searchKnowledgeBaseWithLinks(agentId, userMessage, 3, 0.5, undefined),
  ]);

  resolvedLeadId = contextData.leadId ?? resolvedLeadId;
  resolvedConversationId = contextData.conversationId ?? resolvedConversationId;
  resolvedUserMessageId = contextData.userMessageId ?? resolvedUserMessageId;

  leadId = resolvedLeadId ?? undefined;
  conversationId = resolvedConversationId ?? undefined;
  userMessageId = resolvedUserMessageId ?? undefined;

  const leadContextMode = resolveLeadContextMode(resolvedLeadId ?? undefined, false);
  const orgId = contextData?.orgId ?? null;
  const leadAttributes = contextData?.leadAttributes ?? null;
  const previousConversationSummary = contextData?.previousConversationSummary ?? null;
  const isSandbox = contextData?.isSandbox ?? false;
  const persistedUserMessageId = userMessageId ?? null;
  const leadGrade = (leadAttributes && typeof leadAttributes === 'object')
    ? (leadAttributes.grade as string | number | null | undefined)
    : null;

  // 1. RAG — ищем релевантные чанки ДО вызова Gemini.
  const chunks = retrieval.primaryChunks;
  const linkedChunks = retrieval.linkedChunks;
  const kbContext = retrieval.contextText;

  console.log(`[RAG] Agent ${agentId}: найдено ${chunks.length} чанков для запроса "${userMessage.slice(0, 50)}..."`);
  console.log(`[RAG] Топ-3 чанка:`, chunks.slice(0, 3).map((chunk) => ({
    similarity: chunk.similarity.toFixed(2),
    preview: chunk.content.slice(0, 80),
  })));
  if (persistedUserMessageId) {
    await admin.from('messages').update({
      tool_calls: {
        retrieval: {
          query: userMessage,
          primary_chunk_ids: chunks.map((chunk) => chunk.chunk_id),
          linked_chunk_ids: linkedChunks.map((chunk) => chunk.id),
          linked_chunk_types: linkedChunks.map((chunk) => ({ id: chunk.id, link_type: chunk.link_type, similarity: chunk.similarity })),
        },
      },
    }).eq('id', persistedUserMessageId);
  }
  const flow = normalizeFunnelFlow(agentData?.dialogue_flow);
  const [conversationStateResult, leadFunnelStateResult] = await Promise.all([
    conversationId
      ? admin.from('conversations').select('current_funnel_step').eq('id', conversationId).single()
      : Promise.resolve({ data: null as { current_funnel_step?: string | null } | null }),
    leadId
      ? admin.from('lead_funnel_state').select('pending_script_node_id, pending_script_reply').eq('lead_id', leadId).eq('agent_id', agentId).maybeSingle()
      : Promise.resolve({ data: null as { pending_script_node_id?: unknown; pending_script_reply?: unknown } | null }),
  ]);
  const conversationState = conversationStateResult.data;

  let currentFunnelStep = conversationState?.current_funnel_step ?? flow?.entryNodeId ?? null;
  if (conversationId && !conversationState?.current_funnel_step && flow?.entryNodeId) {
    await admin.from('conversations').update({ current_funnel_step: flow.entryNodeId }).eq('id', conversationId);
  }

  let leadFunnelState: { pending_script_node_id?: unknown; pending_script_reply?: unknown } | null = leadFunnelStateResult.data as { pending_script_node_id?: unknown; pending_script_reply?: unknown } | null;

  const pendingScriptNodeId = typeof leadFunnelState?.pending_script_node_id === 'string'
    ? leadFunnelState.pending_script_node_id
    : null;
  const pendingScriptReply = typeof leadFunnelState?.pending_script_reply === 'string'
    ? leadFunnelState.pending_script_reply
    : null;

  const scriptTurnResolution = await handleScriptNodeTurn({
    admin,
    agentId,
    leadId: leadId ?? null,
    conversationId: conversationId ?? null,
    flow,
    currentFunnelStep,
    pendingScriptNodeId,
    pendingScriptReply,
    userMessage,
    routeExecutor: applyFunnelRouting,
    sendScriptImpl: async () => undefined,
  });

  if (scriptTurnResolution.shouldRoutePendingReply) {
    currentFunnelStep = scriptTurnResolution.currentFunnelStep ?? currentFunnelStep;
  }

  const conversationContext = conversationId
    ? await getCachedConversationContext(admin, conversationId, persistedUserMessageId)
    : {
        conversationSummary: null,
        messagesAfterSummary: history,
        contextTokenCount: null,
        contextTokenCountFallback: false,
      };

  const leadContextItems: string[] = [];
  if (leadAttributes && Object.keys(leadAttributes).length > 0) {
    leadContextItems.push(`Лид attributes:\n${JSON.stringify(leadAttributes, null, 2)}`);
  }
  if (previousConversationSummary) {
    leadContextItems.push(`Предыдущее завершённое общение:\n${previousConversationSummary}`);
  }

  const fullSystemPrompt = basePrompt;
  const extraContextMessages: Array<{ role: string; parts: Array<{ text: string }> }> = [];

  if (leadAttributes && Object.keys(leadAttributes).length > 0) {
    extraContextMessages.push({
      role: 'user',
      parts: [{ text: `Контекст по клиенту:\n${JSON.stringify(leadAttributes, null, 2)}` }],
    });
  }

  if (previousConversationSummary) {
    extraContextMessages.push({
      role: 'user',
      parts: [{ text: `Предыдущее завершённое общение:\n${previousConversationSummary}` }],
    });
  }

  if (kbContext) {
    extraContextMessages.push({
      role: 'user',
      parts: [{ text: `Контекст из базы знаний:\n${kbContext}` }],
    });
  }

  const conversationContents = conversationContext.messagesAfterSummary.map((message) => ({
    role: message.role === 'user' ? 'user' : 'model',
    parts: [{ text: message.text }],
  }));

  // === PHASE B SECTION 2.4: Script vs Dynamic split (Call A) ===
  const scriptTypingSimulation = Boolean((generalCapabilities?.typing_simulation) ?? true);
  const nodeExecution = await resolveDialogueNodeExecution(flow, currentFunnelStep, scriptTypingSimulation);
  const shouldSkipScriptBranch = scriptTurnResolution.shouldRoutePendingReply;
  const shouldRenderScriptBranch = shouldRenderScriptMessage({
    shouldRoutePendingReply: shouldSkipScriptBranch,
    nodeExecutionMode: nodeExecution.mode,
    finalAnswer: nodeExecution.finalAnswer,
  });

  if (shouldRenderScriptBranch && nodeExecution.messageParts && nodeExecution.finalAnswer) {
    // Call A (Script path): Send script_parts directly without Gemini
    console.log(`[SCRIPT_PATH] Agent ${agentId}: sending pre-written script parts from node ${currentFunnelStep}`);

    let messageParts = nodeExecution.messageParts;
    let finalAnswer = nodeExecution.finalAnswer;

    // No hardcoded greeting override here — use the dialogue_flow script node as-is.

    if (leadId) {
      await upsertLeadFunnelState(admin, leadId, agentId, {
        currentNodeId: currentFunnelStep,
        status: 'active',
        isNoMatch: false,
        lastTransitionAt: new Date().toISOString(),
        pendingScriptNodeId: currentFunnelStep,
        pendingScriptReply: finalAnswer,
      });
    }

    // Save script message
    const assistantMessageId = await appendMessage(admin, conversationId ?? null, 'ai', finalAnswer);

    // Log the script call (non-blocking)
    try {
      await admin.from('ai_call_logs').insert({
        conversation_id: conversationId,
        request: {
          type: 'script_message',
          agent_id: agentId,
          node_id: currentFunnelStep,
          script_parts_count: (flow?.nodes?.find((node) => node.id === currentFunnelStep)?.script_parts?.length ?? 0),
        },
        response: {
          raw: finalAnswer,
          final: finalAnswer,
          finish_reason: 'script_message',
        },
      });
    } catch (e) {
      console.warn('[AGENT] failed to log script call', e);
    }

    // Return script result immediately, no Gemini call
    return {
      answer: finalAnswer,
      usedChunks: chunks.map((chunk) => ({ id: chunk.chunk_id, similarity: chunk.similarity })),
      messageParts,
      splitMessages: false,
      typingSimulation: scriptTypingSimulation,
      handoffMessage: undefined,
      retrievalDebug: {
        primaryChunks: chunks.map((chunk) => ({
          id: chunk.chunk_id,
          content: chunk.content,
          similarity: chunk.similarity,
          priority: chunk.priority,
          sourceTitle: (chunk.metadata?.source_title as string | undefined) ?? undefined,
          sourceType: (chunk.metadata?.source_type as string | undefined) ?? undefined,
          postType: (chunk.metadata?.post_type as string | undefined) ?? undefined,
        })),
        linkedChunks: linkedChunks.map((chunk) => ({
          id: chunk.id,
          content: chunk.content,
          similarity: chunk.similarity,
          linkType: chunk.link_type,
          priority: chunk.priority,
          sourceTitle: (chunk.metadata?.source_title as string | undefined) ?? undefined,
          sourceType: (chunk.metadata?.source_type as string | undefined) ?? undefined,
          postType: (chunk.metadata?.post_type as string | undefined) ?? undefined,
        })),
      },
    };
  }
  // === End Script Path ===

  const pricePatterns = [
    /қанша\b/i,
    /баға/i,
    /багас/i,
    /стоимост/i,
    /цен/i,
    /сколько стоит/i,
    /нарх/i,
    /price/i,
  ];
  const isPriceQuestion = pricePatterns.some((pattern) => pattern.test(userMessage));

  if (isPriceQuestion) {
    const priceAnswer = 'Бағасы — 150 000 теңге/ай. Бағаға толық дайын ИИ-агент, қажетті арналарға қосылу, диалогтарды жүргізу, есептер және техникалық баптау кіреді.';
    const splitMessages = Boolean((generalCapabilities?.split_messages) ?? true);
    const splitMaxParts = Math.min(3, Math.max(1, Number(generalCapabilities?.split_max_parts ?? 3)));
    const typingSimulation = Boolean((generalCapabilities?.typing_simulation) ?? true);
    const messageParts = splitAgentMessage(priceAnswer, splitMessages, splitMaxParts).map((part, index) => ({
      text: part.text,
      delayMs: typingSimulation
        ? Math.max(2000 * index, calculateTypingDelay(part.text) + part.delayMs)
        : Math.max(2000 * index, part.delayMs),
    }));

    if (conversationId) {
      await appendMessage(admin, conversationId, 'ai', priceAnswer);
    }

    return {
      answer: priceAnswer,
      usedChunks: [],
      messageParts,
      splitMessages,
      typingSimulation,
      handoffMessage: undefined,
      toolsUsed: [],
      tokensInput: 0,
      tokensOutput: 0,
      latencyMs: Date.now() - startTime,
      retrievalDebug: { primaryChunks: [], linkedChunks: [] },
    };
  }

  const deterministicFactAnswer = tryBuildDeterministicFactAnswerWithLogging(userMessage, chunks, leadGrade);
  if (deterministicFactAnswer) {
    console.log('[FACT_FALLBACK] using deterministic KB fact answer for user message', { agentId, userMessage });
    const splitMessages = Boolean((generalCapabilities?.split_messages) ?? true);
    const splitMaxParts = Math.min(3, Math.max(1, Number(generalCapabilities?.split_max_parts ?? 3)));
    const typingSimulation = Boolean((generalCapabilities?.typing_simulation) ?? true);
    const messageParts = splitAgentMessage(deterministicFactAnswer, splitMessages, splitMaxParts).map((part, index) => ({
      text: part.text,
      delayMs: typingSimulation
        ? Math.max(2000 * index, calculateTypingDelay(part.text) + part.delayMs)
        : Math.max(2000 * index, part.delayMs),
    }));

    if (conversationId) {
      await appendMessage(admin, conversationId, 'ai', deterministicFactAnswer);
      await admin.from('ai_call_logs').insert({
        conversation_id: conversationId,
        request: {
          type: 'deterministic_fact_answer',
          model: GEMINI_CHAT_MODEL,
          user_message: userMessage,
          retrieval: {
            query: userMessage,
            primary_chunk_ids: chunks.map((chunk) => chunk.chunk_id),
            linked_chunk_ids: linkedChunks.map((chunk) => chunk.id),
            linked_chunk_types: linkedChunks.map((chunk) => ({ id: chunk.id, link_type: chunk.link_type, similarity: chunk.similarity })),
          },
        },
        response: {
          final: deterministicFactAnswer,
          finish_reason: 'deterministic_fact_answer',
        },
      });
    }

    return {
      answer: deterministicFactAnswer,
      usedChunks: chunks.map((chunk) => ({ id: chunk.chunk_id, similarity: chunk.similarity })),
      messageParts,
      splitMessages,
      typingSimulation,
      handoffMessage: undefined,
      toolsUsed: [],
      tokensInput: 0,
      tokensOutput: 0,
      latencyMs: Date.now() - startTime,
      retrievalDebug: {
        primaryChunks: chunks.map((chunk) => ({
          id: chunk.chunk_id,
          content: chunk.content,
          similarity: chunk.similarity,
          priority: chunk.priority,
          sourceTitle: (chunk.metadata?.source_title as string | undefined) ?? undefined,
          sourceType: (chunk.metadata?.source_type as string | undefined) ?? undefined,
          postType: (chunk.metadata?.post_type as string | undefined) ?? undefined,
        })),
        linkedChunks: linkedChunks.map((chunk) => ({
          id: chunk.id,
          content: chunk.content,
          similarity: chunk.similarity,
          linkType: chunk.link_type,
          priority: chunk.priority,
          sourceTitle: (chunk.metadata?.source_title as string | undefined) ?? undefined,
          sourceType: (chunk.metadata?.source_type as string | undefined) ?? undefined,
          postType: (chunk.metadata?.post_type as string | undefined) ?? undefined,
        })),
      },
    };
  }

  let response: GeminiClientResponse;
  let tokensInput = 0;
  let tokensOutput = 0;

  try {
    const extraUserContextMessages = [...extraContextMessages];
    const knownName = leadAttributes && typeof leadAttributes === 'object' ? (leadAttributes as any).whatsapp_push_name : null;
    if (typeof knownName === 'string' && isValidLeadName(knownName)) {
      extraUserContextMessages.push({ role: 'user', parts: [{ text: `Известное имя клиента: ${knownName}` }] });
    }

    response = await callGemini(GEMINI_CHAT_MODEL, fullSystemPrompt, [
      ...conversationContents,
      ...extraUserContextMessages,
      { role: 'user', parts: [{ text: userMessage }] },
    ], toolPayload);
    tokensInput += response.payload.usageMetadata?.promptTokenCount ?? 0;
    tokensOutput += response.payload.usageMetadata?.candidatesTokenCount ?? 0;
  } catch (err) {
    const errText = err instanceof Error ? err.message : String(err);
    try {
      const { data: existing } = await admin.from('ai_error_counters').select('consecutive_errors').eq('agent_id', agentId).maybeSingle();
      const prev = existing?.consecutive_errors ?? 0;
      const next = prev + 1;
      await admin.from('ai_error_counters').upsert({ agent_id: agentId, consecutive_errors: next, last_error_at: new Date(), updated_at: new Date().toISOString() });
      if (next >= 3) {
        await admin.from('notification_log').insert({
          org_id: ((await getCachedAgent(admin, agentId, 'org_id')) as { org_id?: string | null } | null)?.org_id,
          agent_id: agentId,
          lead_id: null,
          event_type: 'ai_error',
          payload: { error: errText, attempts: next },
          delivery_status: 'pending'
        });
        await admin.from('ai_error_counters').update({ consecutive_errors: 0, updated_at: new Date().toISOString() }).eq('agent_id', agentId);
      }
    } catch (e) {
      console.error('[orchestrator] failed to record ai_error counter', e);
    }

    throw new Error(`Gemini API error: ${errText}`);
  }

  try {
    await admin.from('ai_error_counters').update({ consecutive_errors: 0, updated_at: new Date().toISOString() }).eq('agent_id', agentId);
  } catch (e) {
    // non-fatal
  }
  let currentParts = normalizeLlmResponseParts(response);
  let finalAnswer = extractTextFromParts(currentParts) || ((response as any).text ?? '');
  let handoffMessage: string | undefined;
  let handoffTriggered = false;

  const toolContext: ToolContext = {
    leadId: leadId ?? '',
    agentId,
    orgId: orgId ?? '',
    conversationId: conversationId ?? '',
    isSandbox,
  };
  let toolCalls = tryExtractToolCalls(currentParts);
  let iterations = 0;
  let toolsUsed: string[] = [];
  const toolUsageCounts: Record<string, number> = {};

  while (iterations < 2 && toolCalls.length > 0) {
    iterations += 1;
    const toolResults: Array<Record<string, unknown>> = [];

    for (const toolCall of toolCalls) {
      if (!allowedToolNames.includes(toolCall.name)) {
        toolResults.push({ name: toolCall.name, result: null, error: `Инструмент ${toolCall.name} не разрешён для этого агента.` });
        continue;
      }

      const policy = getToolExecutionPolicy(toolCall.name, toolUsageCounts);
      if (!policy.shouldExecute) {
        toolResults.push({
          name: toolCall.name,
          result: { skipped: true, reason: policy.reason },
        });
        continue;
      }

      if (toolCall.name === 'redirectToOperator') {
        const explicitHandoffPattern = /(оператор|человек|живой\s+(человек|сотрудник)|переключи|передай|дайте\s+(мне\s+)?(человека|оператора|консультанта))/i;
        if (!explicitHandoffPattern.test(userMessage)) {
          toolResults.push({
            name: toolCall.name,
            result: null,
            error: 'Клиент не просил оператора. Продолжай диалог самостоятельно. Если не знаешь ответ — скажи "Сейчас уточню информацию".',
          });
          continue;
        }
      }

      toolUsageCounts[toolCall.name] = (toolUsageCounts[toolCall.name] ?? 0) + 1;
      toolsUsed.push(toolCall.name);
      console.log('[PROD_TOOL] calling', { agentId, conversationId, name: toolCall.name, args: toolCall.args });
      const toolResult = await executeTool(toolCall as ToolCall, toolContext);
      toolResults.push({ name: toolCall.name, result: toolResult.result, error: toolResult.error });
      console.log('[PROD_TOOL_RESULT]', { agentId, name: toolCall.name, result: toolResult.result, error: toolResult.error });

      if (toolResult.error) {
        console.warn('[PROD_TOOL_ERROR]', { agentId, name: toolCall.name, error: toolResult.error });
        // Не прерываем цикл: модель может ответить из CORE_KNOWLEDGE или дать естественный follow-up.
      }

      if (toolCall.name === 'redirectToOperator' && toolResult.result) {
        const redirectOutcome = await executeRedirectToOperator(
          admin,
          agentId,
          leadId ?? null,
          conversationId ?? null,
          typeof toolCall.args?.reason === 'string' ? toolCall.args.reason : 'Передача оператору',
          handoffConfig,
        );
        finalAnswer = redirectOutcome.answer || finalAnswer;
        handoffMessage = redirectOutcome.handoffMessage;
        handoffTriggered = true;
        break;
      }
    }

    if (handoffTriggered) {
      break;
    }

    const functionResponseParts = toolResults.map((result) => ({
      functionResponse: {
        name: result.name,
        response: result.error ? { error: result.error } : { result: result.result },
      },
    }));
    console.log('[PROD_TOOL_FOLLOWUP]', { agentId, toolResults, functionResponseParts });

    const followUpResponse = await callGemini(
      GEMINI_CHAT_MODEL,
      fullSystemPrompt,
      [
        ...conversationContents,
        { role: 'user', parts: [{ text: userMessage }] },
        { role: 'model', parts: currentParts ?? [] },
        { role: 'user', parts: functionResponseParts },
      ],
      toolPayload,
    );

    tokensInput += followUpResponse.payload.usageMetadata?.promptTokenCount ?? 0;
    tokensOutput += followUpResponse.payload.usageMetadata?.candidatesTokenCount ?? 0;
    currentParts = normalizeLlmResponseParts(followUpResponse);
    finalAnswer = extractTextFromParts(currentParts) || ((followUpResponse as any).text ?? finalAnswer);
    console.log('[PROD_TOOL_FOLLOWUP_RESPONSE]', { agentId, answer: finalAnswer, toolCalls: tryExtractToolCalls(currentParts) });
    toolCalls = tryExtractToolCalls(currentParts);
  }

  if (handoffTriggered) {
    console.log('[PROD_HANDOFF_TRIGGERED]', { agentId, leadId, conversationId, reason: toolsUsed.join(',') });
    finalAnswer = finalAnswer || 'Сейчас подключу коллегу, пожалуйста, подождите.';
  }

  let emptyReplyRetryAttempted = false;

  if (!finalAnswer.trim() && !handoffTriggered) {
    emptyReplyRetryAttempted = true;
    console.warn('[PROD] empty reply returned by Gemini, retrying once', { agentId, conversationId, userMessage });
    try {
      const retryResponse = await callGemini(
        GEMINI_CHAT_MODEL,
        fullSystemPrompt,
        [
          ...conversationContents,
          { role: 'user', parts: [{ text: userMessage }] },
        ],
        toolPayload,
      );
      const retryParts = normalizeLlmResponseParts(retryResponse);
      const retryText = extractTextFromParts(retryParts) || ((retryResponse as any).text ?? '');
      if (retryText.trim()) {
        response = retryResponse;
        currentParts = retryParts;
        finalAnswer = retryText;
        tokensInput += retryResponse.payload.usageMetadata?.promptTokenCount ?? 0;
        tokensOutput += retryResponse.payload.usageMetadata?.candidatesTokenCount ?? 0;
      }
    } catch (retryErr) {
      console.warn('[PROD] empty-reply retry failed', { agentId, conversationId, userMessage, error: retryErr instanceof Error ? retryErr.message : String(retryErr) });
    }
  }

  if (!finalAnswer.trim()) {
    const fallbackPayload = {
      conversationId,
      agentId,
      messages_in_context: conversationContext.messagesAfterSummary.length,
      context_token_count: conversationContext.contextTokenCount ?? null,
      promptTokenCount: response?.payload?.usageMetadata?.promptTokenCount ?? null,
      model: GEMINI_CHAT_MODEL,
      retry_attempted: emptyReplyRetryAttempted,
      user_message: userMessage,
      handoff_triggered: handoffTriggered,
      tools_used: toolsUsed,
    };

    console.warn('[PROD] empty reply fallback activated', fallbackPayload);

    if (conversationId) {
      await admin.from('ai_call_logs').insert({
        conversation_id: conversationId,
        request: {
          type: 'empty_reply_fallback',
          ...fallbackPayload,
        },
        response: {
          final: getEmptyResponseFallbackMessage(),
          fallback_reason: 'empty_reply',
        },
      });
    }

    finalAnswer = getEmptyResponseFallbackMessage();
  }

  // === PHASE B SECTION 2.4: Call B - Funnel Routing ===
  const routingResult = await applyRoutingAndFinalizeReply({
    admin,
    agentId,
    leadId: leadId ?? null,
    conversationId: conversationId ?? null,
    flow,
    currentFunnelStep,
    userMessage,
    finalAnswer,
    handoffConfig,
    executeToolImpl: async (call, context) => executeTool(call as any, context),
  });

  handoffTriggered = handoffTriggered || routingResult.handoffTriggered;
  finalAnswer = routingResult.finalAnswer;
  // === End Routing ===

  if (conversationId && routingResult.shouldAppendMessage) {
    await appendMessage(admin, conversationId, 'ai', finalAnswer);
  }

  const rawReply = extractTextFromParts(currentParts);
  if (conversationId) {
    await admin.from('ai_call_logs').insert({
      conversation_id: conversationId,
      request: {
        type: 'agent_response',
        model: GEMINI_CHAT_MODEL,
        user_message: userMessage,
        context_mode: conversationContext.conversationSummary ? 'summary+tail' : 'full_history',
        messages_in_context: conversationContext.messagesAfterSummary.length,
        summary_used: Boolean(conversationContext.conversationSummary),
        tools_used: toolsUsed,
        iterations,
        context_token_count: conversationContext.contextTokenCount ?? null,
        context_token_count_fallback: conversationContext.contextTokenCountFallback ?? false,
        retrieval: {
          query: userMessage,
          primary_chunk_ids: chunks.map((chunk) => chunk.chunk_id),
          linked_chunk_ids: linkedChunks.map((chunk) => chunk.id),
          linked_chunk_types: linkedChunks.map((chunk) => ({ id: chunk.id, link_type: chunk.link_type, similarity: chunk.similarity })),
        },
        routing: routingResult.routingOutcome,
        lead_context: {
          mode: leadContextMode,
          externalLeadId: null,
          preferRealLead: false,
          leadId: leadId ?? null,
          conversationId: conversationId ?? null,
          isSandbox,
        },
      },
      response: {
        raw: rawReply,
        final: finalAnswer,
        provider: response.provider ?? 'gemini',
        finish_reason: response.payload.finishReason ?? null,
        usage_metadata: response.payload.usageMetadata ?? null,
      },
      tokens_input: tokensInput,
      tokens_output: tokensOutput,
      latency_ms: Date.now() - startTime,
    });
  }

  const capabilities = generalCapabilities ?? {};
  const splitMessages = Boolean(capabilities.split_messages ?? true);
  const splitMaxParts = Math.min(3, Math.max(1, Number(capabilities.split_max_parts ?? 3)));
  const typingSimulation = Boolean(capabilities.typing_simulation ?? true);

  const messageParts = splitAgentMessage(finalAnswer, splitMessages, splitMaxParts).map((part, index) => ({
    text: part.text,
    delayMs: typingSimulation
      ? Math.max(2000 * index, calculateTypingDelay(part.text) + part.delayMs)
      : Math.max(2000 * index, part.delayMs),
  }));

  return {
    answer: finalAnswer,
    usedChunks: chunks.map((chunk) => ({ id: chunk.chunk_id, similarity: chunk.similarity })),
    messageParts,
    splitMessages,
    typingSimulation,
    handoffMessage,
    toolsUsed,
    tokensInput,
    tokensOutput,
    latencyMs: Date.now() - startTime,
    retrievalDebug: {
      primaryChunks: chunks.map((chunk) => ({
        id: chunk.chunk_id,
        content: chunk.content,
        similarity: chunk.similarity,
        priority: chunk.priority,
        sourceTitle: (chunk.metadata?.source_title as string | undefined) ?? undefined,
        sourceType: (chunk.metadata?.source_type as string | undefined) ?? undefined,
        postType: (chunk.metadata?.post_type as string | undefined) ?? undefined,
      })),
      linkedChunks: linkedChunks.map((chunk) => ({
        id: chunk.id,
        content: chunk.content,
        similarity: chunk.similarity,
        linkType: chunk.link_type,
        priority: chunk.priority,
        sourceTitle: (chunk.metadata?.source_title as string | undefined) ?? undefined,
        sourceType: (chunk.metadata?.source_type as string | undefined) ?? undefined,
        postType: (chunk.metadata?.post_type as string | undefined) ?? undefined,
      })),
    },
  };
}
