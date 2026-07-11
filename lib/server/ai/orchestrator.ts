 import { searchKnowledgeBaseWithLinks } from '@/lib/knowledge-base/search';
import { geminiFetch, geminiCountTokens, GEMINI_CHAT_MODEL, GEMINI_PROMPT_MODEL } from '@/lib/server/ai/gemini-client';
import { createAdminClient } from '@/lib/supabase/admin';
import { splitAgentMessage, calculateTypingDelay } from '@/lib/server/ai/message-splitter';
import { injectHandoffSection, normalizeHandoffConfig, type HandoffConfig } from '@/lib/server/ai/handoff';
import { sendTelegramNotification } from '@/lib/extensions/telegram-notify';
import { PRODUCTION_TOOL_DECLARATIONS, buildToolDeclarationsForAgent, type ToolCall } from '@/lib/ai/tools/registry';
import { executeTool, type ToolContext } from '@/lib/ai/tools/executor';
import { normalizeFunnelFlow } from '@/lib/funnel/normalize';
import { compileFlowToPrompt } from '@/lib/funnel/compile';
import { applyFunnelRouting, resolvePostRoutingReply, upsertLeadFunnelState } from '@/lib/funnel/routing';
import { buildSandboxLeadAttributes, isSandboxLeadAttributes } from '@/lib/ai/sandbox-context';

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

// === PHASE B SECTION 2.4: Script vs Dynamic split (Call A) ===
// Helper: Find dialogue node by ID in funnel flow
function getDialogueNode(flow: ReturnType<typeof normalizeFunnelFlow> | null | undefined, nodeId: string | null) {
  if (!flow || !nodeId) return null;
  return flow.nodes?.find((node) => node.id === nodeId) ?? null;
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

  if (currentDialogueNode?.message_type === 'script') {
    if (Array.isArray(currentDialogueNode?.script_parts) && currentDialogueNode.script_parts.length > 0) {
      const messageParts = handleScriptMessageParts(currentDialogueNode.script_parts, typingSimulationEnabled);
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
  const { data: agentData } = await admin
    .from('agents')
    .select('general_capabilities')
    .eq('id', agentId)
    .single();

  return normalizeHandoffConfig((agentData?.general_capabilities as Record<string, unknown> | null)?.handoff_config);
}

function getEntryNodeId(flow: ReturnType<typeof normalizeFunnelFlow>): string | null {
  return flow?.entryNodeId ? flow.entryNodeId : null;
}

async function ensureLeadContext(admin: ReturnType<typeof createAdminClient>, agentId: string, userMessage: string, externalLeadId?: string) {
  const { data: agentData, error: agentError } = await admin
    .from('agents')
    .select('org_id, dialogue_flow')
    .eq('id', agentId)
    .single();

  if (agentError || !agentData?.org_id) {
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

  if (externalLeadId) {
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
        .insert({
          lead_id: externalLeadId,
          agent_id: agentId,
          ...(entryNodeId ? { current_funnel_step: entryNodeId } : {}),
        })
        .select('id')
        .single();
      conversation = createdConversation;
    }

    const insertedMessage = conversation?.id
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
  let { data: lead } = await admin
    .from('leads')
    .select('id, attributes')
    .eq('org_id', agentData.org_id)
    .eq('external_id', externalId)
    .maybeSingle();

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
    lead = createdLead;
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

  let { data: conversation } = await admin
    .from('conversations')
    .select('id')
    .eq('lead_id', lead.id)
    .eq('agent_id', agentId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conversation) {
    const entryNodeId = getEntryNodeId(normalizeFunnelFlow(agentData?.dialogue_flow));
    const { data: createdConversation } = await admin
      .from('conversations')
      .insert({
        lead_id: lead.id,
        agent_id: agentId,
        ...(entryNodeId ? { current_funnel_step: entryNodeId } : {}),
      })
      .select('id')
      .single();
    conversation = createdConversation;
  }

  const insertedMessage = conversation?.id
    ? await admin.from('messages').insert({
        conversation_id: conversation.id,
        sender: 'user',
        content: userMessage,
      }).select('id').single()
    : null;

  return {
    leadId: lead.id,
    conversationId: conversation?.id ?? null,
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

  return `\n\nТы сейчас на шаге "${currentFunnelStep}". После ответа система автоматически определит следующий шаг воронки по текущему контексту. Не пытайся вручную переключать шаги через инструменты — просто продолжай диалог в рамках текущего шага.`;
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

function extractTextFromParts(parts: Array<Record<string, unknown>> | undefined): string {
  if (!Array.isArray(parts)) return '';

  return parts
    .filter((part) => typeof part?.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

const SUMMARY_TOKEN_THRESHOLD = 150_000;
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
) {
  let query = admin
    .from('messages')
    .select('id, sender, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (excludeMessageId) {
    query = query.neq('id', excludeMessageId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load conversation messages: ${error.message}`);
  }

  return (data as Array<{ id: string; sender: string | null; content: string | null }> | null) ?? [];
}

async function callGemini(
  modelName: string,
  systemPrompt: string,
  contents: Array<Record<string, unknown>>,
  tools: Array<Record<string, unknown>>,
  previousToolCalls?: Array<Record<string, unknown>>,
  generationConfig: Record<string, unknown> = { temperature: 0.7, topP: 0.9, maxOutputTokens: 512 },
  retryCount = 0,
): Promise<GeminiClientResponse> {
  const fallbackModel = 'gemini-2.5-flash';

  async function execute(activeModel: string): Promise<GeminiClientResponse> {
    const body: Record<string, unknown> = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      tools,
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      generationConfig,
    };

    let res: Response;
    try {
      res = await geminiFetch(activeModel, 'generateContent', body);
    } catch (err: any) {
      const errorContext = {
        model: activeModel,
        endpoint: 'generateContent',
        retryCount,
        code: err?.code,
        message: err?.message,
        stack: err?.stack,
      };
      console.error('[GEMINI:SERVER] fetch call failed', errorContext);
      throw err;
    }

    if (!res.ok) {
      const errText = await res.text();
      const errorMessage = `Gemini API error ${res.status}: ${errText}`;
      const combinedText = `${errText} ${res.status}`.toLowerCase();
      const isModelIssue = res.status === 404 || /model not found|deprecated|not supported|does not support/i.test(combinedText);
      if (isModelIssue) {
        const modelIssueError = new Error(errorMessage) as Error & { status?: number };
        modelIssueError.status = res.status;
        throw modelIssueError;
      }
      console.error('[GEMINI:SERVER] non-ok response', { status: res.status, error: errText, model: activeModel });
      throw new Error(errorMessage);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0] ?? null;
    const parts = (candidate?.content?.parts as Array<Record<string, unknown>> | undefined) ?? [];
    const usageMetadata = candidate?.usageMetadata ?? data.usageMetadata ?? {};
    const finishReason = candidate?.finishReason ?? candidate?.finish_reason;
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
        payload: {
          parts: normalizedParts,
          finishReason,
          usageMetadata: {
            promptTokenCount: usageMetadata?.promptTokenCount ?? usageMetadata?.prompt_tokens ?? 0,
            candidatesTokenCount: usageMetadata?.candidatesTokenCount ?? usageMetadata?.candidates_tokens ?? 0,
          },
        },
      };
    }

    return {
      payload: {
        parts: normalizedParts,
        finishReason,
        usageMetadata: {
          promptTokenCount: usageMetadata?.promptTokenCount ?? usageMetadata?.prompt_tokens ?? 0,
          candidatesTokenCount: usageMetadata?.candidatesTokenCount ?? usageMetadata?.candidates_tokens ?? 0,
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

  const tokenContents = serializeContentForTokenCount(conversation?.summary, formattedMessages);
  const { tokens: totalTokens, fallback: tokenEstimateFallback } = await estimateContentTokens(tokenContents);
  if (totalTokens <= SUMMARY_TOKEN_THRESHOLD) {
    return {
      conversationSummary: conversation?.summary ?? null,
      messagesAfterSummary: formattedMessages,
      summaryUpToMessageId,
      contextTokenCount: totalTokens,
      contextTokenCountFallback: tokenEstimateFallback,
    };
  }

  const compressibleCount = Math.max(1, formattedMessages.length - SUMMARY_TAIL_MESSAGES);
  const messagesToCompress = formattedMessages.slice(0, compressibleCount);
  const tailMessages = formattedMessages.slice(compressibleCount);

  if (messagesToCompress.length === 0) {
    return {
      conversationSummary: conversation?.summary ?? null,
      messagesAfterSummary: formattedMessages,
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
    messagesAfterSummary: tailMessages,
    summaryUpToMessageId: updatedSummaryId,
    contextTokenCount: totalTokens,
    contextTokenCountFallback: tokenEstimateFallback,
  };
}

export async function runAgentTurn(
  agentId: string,
  systemPrompt: string,
  userMessage: string,
  history: ChatMessage[] = [],
  externalLeadId?: string, // Optional: for Telegram/webhook-identified leads
): Promise<AgentTurnResult> {
  const admin = createAdminClient();
  const startTime = Date.now();
  const handoffConfig = await readAgentCapabilities(admin, agentId);
  const basePrompt = injectHandoffSection(systemPrompt, handoffConfig);

  // Читаем allowed_tools конкретного агента
  const { data: agentData } = await admin
    .from('agents')
    .select('general_capabilities, dialogue_flow')
    .eq('id', agentId)
    .single();

  const generalCapabilities = (agentData?.general_capabilities as Record<string, unknown> | null) ?? {};
  const allowedToolNames = Array.isArray(generalCapabilities.allowed_tools)
    ? (generalCapabilities.allowed_tools as string[]).filter((name) => typeof name === 'string')
    : PRODUCTION_TOOL_DECLARATIONS.map((d) => d.name); // Fallback to baseline if not set

  // Формируем toolDeclarations только для разрешённых тулов
  const toolDeclarations = buildToolDeclarationsForAgent(allowedToolNames, agentData?.dialogue_flow);
  console.log(`[AGENT_TOOLS] Agent ${agentId}: allowed tools: [${allowedToolNames.join(', ')}], declarations: [${toolDeclarations.map((d) => d.name).join(', ')}]`);

  // 1. RAG — ищем релевантные чанки ДО вызова Gemini
  const retrieval = await searchKnowledgeBaseWithLinks(agentId, userMessage);
  const chunks = retrieval.primaryChunks;
  const linkedChunks = retrieval.linkedChunks;
  const kbContext = retrieval.contextText;

  console.log(`[RAG] Agent ${agentId}: найдено ${chunks.length} чанков для запроса "${userMessage.slice(0, 50)}..."`);
  console.log(`[RAG] Топ-3 чанка:`, chunks.slice(0, 3).map((chunk) => ({
    similarity: chunk.similarity.toFixed(2),
    preview: chunk.content.slice(0, 80),
  })));

  const { leadId, conversationId, orgId, leadAttributes, previousConversationSummary, userMessageId, isSandbox } = await ensureLeadContext(admin, agentId, userMessage, externalLeadId);
  if (userMessageId) {
    await admin.from('messages').update({
      tool_calls: {
        retrieval: {
          query: userMessage,
          primary_chunk_ids: chunks.map((chunk) => chunk.chunk_id),
          linked_chunk_ids: linkedChunks.map((chunk) => chunk.id),
          linked_chunk_types: linkedChunks.map((chunk) => ({ id: chunk.id, link_type: chunk.link_type, similarity: chunk.similarity })),
        },
      },
    }).eq('id', userMessageId);
  }
  const flow = normalizeFunnelFlow(agentData?.dialogue_flow);
  const { data: conversationState } = conversationId
    ? await admin.from('conversations').select('current_funnel_step').eq('id', conversationId).single()
    : { data: null };

  let currentFunnelStep = conversationState?.current_funnel_step ?? flow?.entryNodeId ?? null;
  if (conversationId && !conversationState?.current_funnel_step && flow?.entryNodeId) {
    await admin.from('conversations').update({ current_funnel_step: flow.entryNodeId }).eq('id', conversationId);
  }

  let leadFunnelState: { pending_script_node_id?: unknown; pending_script_reply?: unknown } | null = null;
  if (leadId) {
    const { data } = await admin
      .from('lead_funnel_state')
      .select('pending_script_node_id, pending_script_reply')
      .eq('lead_id', leadId)
      .eq('agent_id', agentId)
      .maybeSingle();
    leadFunnelState = data as { pending_script_node_id?: unknown; pending_script_reply?: unknown } | null;
  }

  const pendingScriptNodeId = typeof leadFunnelState?.pending_script_node_id === 'string'
    ? leadFunnelState.pending_script_node_id
    : null;
  const pendingScriptReply = typeof leadFunnelState?.pending_script_reply === 'string'
    ? leadFunnelState.pending_script_reply
    : null;

  const scriptTurnResolution = await handleScriptNodeTurn({
    admin,
    agentId,
    leadId,
    conversationId,
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
    ? await buildConversationContext(admin, conversationId, userMessageId)
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

  const leadContextBlock = leadContextItems.length > 0
    ? `<lead_context>\n${leadContextItems.join('\n\n')}\n</lead_context>\n\n`
    : '';

  const previousConversationBlock = conversationContext.conversationSummary
    ? `<previous_conversation_context>\n${conversationContext.conversationSummary}\n</previous_conversation_context>\n\n`
    : '';

  const stepContext = flow && currentFunnelStep
    ? `\n\n<funnel_context>\n${compileFlowToPrompt(flow, currentFunnelStep)}\n</funnel_context>`
    : '';

  const fullSystemPrompt = `${basePrompt}\n\n${leadContextBlock}${previousConversationBlock}${stepContext}\n\n<knowledge_base>\n${kbContext}\n</knowledge_base>\n\nПравило: отвечай ТОЛЬКО на основе информации выше. Если данных нет — честно скажи об этом.`;

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

    const messageParts = nodeExecution.messageParts;
    const finalAnswer = nodeExecution.finalAnswer;

    await upsertLeadFunnelState(admin, leadId, agentId, {
      currentNodeId: currentFunnelStep,
      status: 'active',
      isNoMatch: false,
      lastTransitionAt: new Date().toISOString(),
      pendingScriptNodeId: currentFunnelStep,
      pendingScriptReply: finalAnswer,
    });

    // Save script message
    const assistantMessageId = await appendMessage(admin, conversationId, 'ai', finalAnswer);

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

  let response: GeminiClientResponse;
  let tokensInput = 0;
  let tokensOutput = 0;

  try {
    response = await callGemini(GEMINI_CHAT_MODEL, fullSystemPrompt, [
      ...conversationContents,
      { role: 'user', parts: [{ text: userMessage }] },
    ], [{ functionDeclarations: toolDeclarations }]);
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
          org_id: (await admin.from('agents').select('org_id').eq('id', agentId).maybeSingle()).data?.org_id,
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
  let currentParts = response.payload.parts;
  let finalAnswer = extractTextFromParts(currentParts);
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

  while (iterations < 5 && toolCalls.length > 0) {
    iterations += 1;
    const toolResults: Array<Record<string, unknown>> = [];

    for (const toolCall of toolCalls) {
      if (!allowedToolNames.includes(toolCall.name)) {
        toolResults.push({ name: toolCall.name, result: null, error: `Инструмент ${toolCall.name} не разрешён для этого агента.` });
        continue;
      }

      const previousCalls = toolUsageCounts[toolCall.name] ?? 0;
      if (toolCall.name === 'searchKnowledgeBase' && previousCalls >= 1) {
        toolResults.push({
          name: toolCall.name,
          result: { skipped: true, reason: 'searchKnowledgeBase already used in this turn' },
        });
        continue;
      }

      toolUsageCounts[toolCall.name] = previousCalls + 1;
      toolsUsed.push(toolCall.name);
      console.log('[PROD_TOOL] calling', { agentId, conversationId, name: toolCall.name, args: toolCall.args });
      const toolResult = await executeTool(toolCall as ToolCall, toolContext);
      toolResults.push({ name: toolCall.name, result: toolResult.result, error: toolResult.error });
      console.log('[PROD_TOOL_RESULT]', { agentId, name: toolCall.name, result: toolResult.result, error: toolResult.error });

      if (toolCall.name === 'redirectToOperator' && toolResult.result && !toolResult.error) {
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
      [{ functionDeclarations: toolDeclarations }],
    );

    tokensInput += followUpResponse.payload.usageMetadata?.promptTokenCount ?? 0;
    tokensOutput += followUpResponse.payload.usageMetadata?.candidatesTokenCount ?? 0;
    currentParts = followUpResponse.payload.parts;
    finalAnswer = extractTextFromParts(currentParts) || finalAnswer;
    console.log('[PROD_TOOL_FOLLOWUP_RESPONSE]', { agentId, answer: finalAnswer, toolCalls: tryExtractToolCalls(currentParts) });
    toolCalls = tryExtractToolCalls(currentParts);
  }

  if (handoffTriggered) {
    console.log('[PROD_HANDOFF_TRIGGERED]', { agentId, leadId, conversationId, reason: toolsUsed.join(',') });
    finalAnswer = finalAnswer || 'Сейчас подключу коллегу, пожалуйста, подождите.';
  }

  if (!finalAnswer.trim() && !handoffTriggered) {
    console.warn('[PROD] empty reply returned by Gemini, retrying once', { agentId, conversationId, userMessage });
    try {
      const retryResponse = await callGemini(
        GEMINI_CHAT_MODEL,
        fullSystemPrompt,
        [
          ...conversationContents,
          { role: 'user', parts: [{ text: userMessage }] },
        ],
        [{ functionDeclarations: toolDeclarations }],
      );
      const retryParts = retryResponse.payload.parts;
      const retryText = extractTextFromParts(retryParts);
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
    finalAnswer = handoffConfig.client_message?.trim() || 'Подключаю сотрудника, он уже видит наш диалог';
  }

  // === PHASE B SECTION 2.4: Call B - Funnel Routing ===
  const routingResult = await applyRoutingAndFinalizeReply({
    admin,
    agentId,
    leadId,
    conversationId,
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
      },
      response: {
        raw: rawReply,
        final: finalAnswer,
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

  const messageParts = splitAgentMessage(finalAnswer, splitMessages, splitMaxParts).map((part) => ({
    text: part.text,
    delayMs: typingSimulation ? calculateTypingDelay(part.text) + part.delayMs : part.delayMs,
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
