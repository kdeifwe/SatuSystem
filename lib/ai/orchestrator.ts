import { createAdminClient } from '../supabase/admin.ts';
import { llmClient } from '../server/ai/llm-client';
import { GEMINI_CHAT_MODEL } from '../server/ai/gemini-client.ts';
import { AGENT_TOOLS, mergeAllowedToolNames, type ToolCall } from './tools/registry.ts';
import { executeTool, type ToolContext } from './tools/executor.ts';
import { validateAgentAnswer } from './validate-output.ts';
import { compileAndSaveSystemPrompt } from './compile-system-prompt.ts';
import { buildRetryContents } from './retry-context.ts';
import { shouldBypassStyleValidation, shouldUseFallbackReply } from './response-policy';
import { normalizeFunnelFlow } from '../funnel/normalize.ts';
import { applyFunnelRouting, resolvePostRoutingReply, upsertLeadFunnelState } from '../funnel/routing.ts';
import { handleScriptNodeTurn, shouldRenderScriptMessage } from '../server/ai/orchestrator.ts';
import { buildSandboxLeadAttributes, isSandboxLeadAttributes, buildSandboxConversationInsertData } from './sandbox-context';
import { calculateTypingDelay, splitAgentMessage } from '../server/ai/message-splitter.ts';

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
  usedChunks: Array<{ id: string; similarity: number }>;
  messageParts: AgentMessagePart[];
  splitMessages: boolean;
  typingSimulation: boolean;
  toolsUsed?: string[];
  tokensInput?: number;
  tokensOutput?: number;
  latencyMs?: number;
  finishReason?: string;
}

interface GeminiResponsePayload {
  parts: Array<Record<string, unknown>>;
  finishReason?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

interface GeminiClientResponse {
  payload: GeminiResponsePayload;
  usedModel: string;
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

const AGENT_CACHE_TTL_MS = 30_000;
const agentCache = new Map<string, { expiresAt: number; data: Record<string, unknown> | null }>();

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

// === PHASE B SECTION 2.4: Script vs Dynamic split (Call A) ===
// Helper: Find dialogue node by ID in funnel flow
function getDialogueNode(flow: ReturnType<typeof normalizeFunnelFlow>, nodeId: string | null) {
  if (!flow || !nodeId) return null;
  return flow.nodes?.find((node) => node.id === nodeId) ?? null;
}

// Helper: Convert script_parts array to AgentMessagePart[] with typing delays
function handleScriptMessageParts(
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
// === End Script Path helpers ===

async function ensureLeadContext(admin: ReturnType<typeof createAdminClient>, agentId: string, userMessage: string) {
  const agentData = await getCachedAgent(admin, agentId, 'org_id') as { org_id?: string | null } | null;
  if (!agentData?.org_id) {
    return { leadId: null, conversationId: null, userMessageId: null };
  }

  const externalId = `sandbox:${agentId}`;
  let { data: lead } = await admin.from('leads').select('id, attributes').eq('org_id', agentData.org_id).eq('external_id', externalId).maybeSingle();

  if (!lead) {
    const { data: createdLead } = await admin.from('leads').insert({
      org_id: agentData.org_id,
      external_id: externalId,
      name: 'Sandbox lead',
      ai_enabled: true,
      attributes: buildSandboxLeadAttributes(),
    }).select('id, attributes').single();
    lead = createdLead;
  }

  if (lead?.id && !isSandboxLeadAttributes((lead.attributes as Record<string, unknown> | null) ?? null)) {
    await admin.from('leads').update({ attributes: buildSandboxLeadAttributes(lead.attributes as Record<string, unknown> | null) }).eq('id', lead.id);
  }

  if (!lead?.id) {
    return { leadId: null, conversationId: null, userMessageId: null };
  }

  let { data: conversation } = await admin.from('conversations').select('id').eq('lead_id', lead.id).eq('agent_id', agentId).order('started_at', { ascending: false }).limit(1).maybeSingle();

  if (!conversation) {
    const { data: createdConversation } = await admin.from('conversations').insert(buildSandboxConversationInsertData({
      lead_id: lead.id,
      agent_id: agentId,
    })).select('id').single();
    conversation = createdConversation;
  }

  const { data: insertedMessage, error: messageError } = await admin.from('messages').insert({
    conversation_id: conversation?.id,
    sender: 'user',
    content: userMessage,
  }).select('id').single();

  if (messageError || !insertedMessage?.id) {
    return { leadId: lead.id, conversationId: conversation?.id ?? null, userMessageId: null };
  }

  return { leadId: lead.id, conversationId: conversation?.id ?? null, userMessageId: insertedMessage.id };
}

function buildChatHistory(history: ChatMessage[]) {
  return history.filter((m) => m.text?.trim()).map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.text }],
  }));
}

function extractToolCalls(parts: Array<Record<string, unknown>> | undefined): ToolCall[] {
  if (!Array.isArray(parts)) return [];

  return parts.filter((part) => typeof part?.functionCall === 'object' && part.functionCall && typeof (part.functionCall as Record<string, unknown>).name === 'string').map((part) => ({
    name: ((part.functionCall as Record<string, unknown>).name as string) as ToolCall['name'],
    args: ((part.functionCall as Record<string, unknown>).args as Record<string, unknown>) ?? {},
  }));
}

const DEFAULT_MAX_OUTPUT_TOKENS = 512;

async function callGemini(
  modelName: string,
  systemPrompt: string,
  contents: Array<Record<string, unknown>>,
  tools: Array<Record<string, unknown>>,
  previousToolCalls?: Array<Record<string, unknown>>,
  generationConfig: Record<string, unknown> = { temperature: 0.7, topP: 0.9, maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS },
  retryCount = 0,
): Promise<GeminiClientResponse> {
  const fallbackModel = 'gemini-2.5-flash';

  async function execute(activeModel: string): Promise<GeminiClientResponse> {
    const body: Record<string, unknown> = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig,
    };

    if (Array.isArray(tools) && tools.length > 0) {
      body.tools = tools;
      body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
    } else {
      body.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
    }

    if (process.env.LOG_GEMINI_RAW === '1') {
      try {
        console.log('[GEMINI][REQUEST_BODY]', JSON.stringify(body));
      } catch (e) {
        console.warn('[GEMINI] failed to stringify request body', e);
      }
    }

    if (previousToolCalls && previousToolCalls.length > 0) {
      body.contents = contents;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(contents.map((content) => ({
        role: content.role === 'model' ? 'assistant' : (content.role as 'user' | 'assistant'),
        content: Array.isArray(content.parts)
          ? content.parts.map((part) => (typeof part?.text === 'string' ? part.text : '')).filter(Boolean).join('\n')
          : '',
      })) as any[]),
    ];

    const llmResponse = await llmClient.generate({
      model: activeModel,
      messages,
      temperature: (generationConfig as any)?.temperature ?? 0.7,
      maxTokens: (generationConfig as any)?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      tools: Array.isArray(tools) && tools.length > 0 ? tools : undefined,
    });

    const contentParts: Array<Record<string, unknown>> = [];
    if (typeof llmResponse.text === 'string' && llmResponse.text.trim().length > 0) {
      contentParts.push({ text: llmResponse.text });
    }
    if (Array.isArray(llmResponse.toolCalls) && llmResponse.toolCalls.length > 0) {
      for (const toolCall of llmResponse.toolCalls) {
        contentParts.push({ functionCall: { name: toolCall.name, args: toolCall.args } });
      }
    }

    const data = {
      candidates: [
        {
          content: {
            parts: contentParts,
          },
        },
      ],
    };
    if (process.env.LOG_GEMINI_RAW === '1') {
      try {
        console.log('[GEMINI][RAW_RESPONSE_JSON]', JSON.stringify(data, null, 2));
        console.log('[GEMINI][RAW_RESPONSE_CANDIDATE0]', JSON.stringify(data.candidates?.[0] ?? null, null, 2));
      } catch (e) {
        console.warn('[GEMINI] failed to stringify raw response', e);
      }
    }
    const candidate = data.candidates?.[0];
    const parts = (candidate?.content?.parts as Array<Record<string, unknown>> | undefined) ?? [];
    const finishReason = llmResponse.finishReason;
    const normalizedParts = normalizeResponseParts(parts, finishReason);

    if (finishReason === 'MAX_TOKENS' && retryCount === 0) {
      const currentMax = Number((generationConfig as any)?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS);
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
            promptTokenCount: Number((llmResponse.usage as any)?.promptTokens ?? 0),
            candidatesTokenCount: Number((llmResponse.usage as any)?.completionTokens ?? 0),
          },
        },
        usedModel: activeModel,
      };
    }

    return {
      payload: {
        parts: normalizedParts,
        finishReason,
        usageMetadata: {
          promptTokenCount: Number((llmResponse.usage as any)?.promptTokens ?? 0),
          candidatesTokenCount: Number((llmResponse.usage as any)?.completionTokens ?? 0),
        },
      },
      usedModel: activeModel,
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

async function appendMessage(admin: ReturnType<typeof createAdminClient>, conversationId: string | null, sender: 'ai' | 'system', content: string, toolCalls?: unknown) {
  if (!conversationId) return null;
  const { data, error } = await admin.from('messages').insert({ conversation_id: conversationId, sender, content, tool_calls: toolCalls ?? null }).select('id').single();
  if (error) throw new Error(`Не удалось сохранить сообщение: ${error.message}`);
  return data?.id ?? null;
}

export function buildFunnelStepInstruction(currentFunnelStep: string | null | undefined): string {
  if (!currentFunnelStep) return '';

  return `\n\nТы сейчас на шаге "${currentFunnelStep}". После ответа система автоматически определит следующий шаг воронки по текущему контексту. Не пытайся вручную переключать шаги через инструменты — просто продолжай диалог в рамках текущего шага. Для перехода к следующему шагу используй advanceFunnelStep.`;
}

async function logErrorIncident(admin: ReturnType<typeof createAdminClient>, agentId: string, details: Record<string, unknown>) {
  try {
    const { data: existing } = await admin.from('ai_error_counters').select('consecutive_errors').eq('agent_id', agentId).maybeSingle();
    const prev = existing?.consecutive_errors ?? 0;
    const next = prev + 1;

    await admin.from('ai_error_counters').upsert({
      agent_id: agentId,
      consecutive_errors: next,
      last_error_at: new Date(),
      updated_at: new Date().toISOString(),
    });

    const { data: agent } = await admin.from('agents').select('org_id').eq('id', agentId).maybeSingle();
    await admin.from('notification_log').insert({
      org_id: agent?.org_id ?? null,
      agent_id: agentId,
      lead_id: null,
      event_type: 'ai_error',
      payload: { metric: 'error_rate', ...details, attempts: next },
      delivery_status: 'pending',
    });
  } catch (error) {
    console.warn('[AGENT] failed to record error incident', error);
  }
}

async function resolveFallbackReply(
  admin: ReturnType<typeof createAdminClient>,
  agentId: string,
  _allowedToolNames: string[],
  _toolContext: ToolContext,
  _reason: string,
): Promise<{ reply: string; handoffTriggered: boolean }> {
  const { data: agent } = await admin.from('agents').select('knowledge_base_principles').eq('id', agentId).maybeSingle();
  const rawPrinciples = agent?.knowledge_base_principles;
  const principlesLines: string[] = Array.isArray(rawPrinciples)
    ? rawPrinciples.filter((line): line is string => typeof line === 'string')
    : typeof rawPrinciples === 'string'
      ? rawPrinciples.split(/\n+/)
      : [];
  const configuredReply = principlesLines
    .map((line) => line.trim())
    .find((line) => line.length > 0 && line.length < 220 && /(вернусь|уточнить|сейчас|скоро|подтвержу)/i.test(line));

  return {
    reply: configuredReply ?? 'Сейчас уточню информацию и вернусь с ответом.',
    handoffTriggered: false,
  };
}

export async function runAgentTurn(agentId: string, systemPrompt: string, userMessage: string, history: ChatMessage[]): Promise<AgentTurnResult> {
  const admin = createAdminClient();
  const startTime = Date.now();
  const agent = (await getCachedAgent(admin, agentId, 'id, name, model, temperature, top_p, org_id, system_prompt_compiled, general_capabilities, dialogue_flow')) as {
    id?: string;
    name?: string | null;
    model?: string | null;
    temperature?: number | null;
    top_p?: number | null;
    org_id?: string | null;
    system_prompt_compiled?: string | null;
    general_capabilities?: Record<string, unknown> | null;
    dialogue_flow?: unknown;
  } | null;

  if (!agent) {
    throw new Error(`Агент не найден: ${agentId}`);
  }

  let compiledPrompt = agent.system_prompt_compiled ?? systemPrompt;
  if (!compiledPrompt?.trim()) {
    compiledPrompt = await compileAndSaveSystemPrompt(agentId);
  }

  const generalCapabilities = (agent.general_capabilities as Record<string, unknown> | null) ?? {};
  const configuredAllowedTools = Array.isArray(generalCapabilities.allowed_tools)
    ? (generalCapabilities.allowed_tools as string[]).filter((name) => typeof name === 'string')
    : [];

  const availableToolNames = AGENT_TOOLS[0].functionDeclarations?.map((f) => f.name) ?? [];
  const allowedToolNames = (configuredAllowedTools.length > 0
    ? mergeAllowedToolNames(configuredAllowedTools, [])
    : mergeAllowedToolNames(availableToolNames, []))
    .filter((name) => availableToolNames.includes(name));

  const allowedToolDeclarations = allowedToolNames.length > 0
    ? [{ functionDeclarations: AGENT_TOOLS[0].functionDeclarations.filter((f) => allowedToolNames.includes(f.name)) }]
    : [];

  const typingSimulation = Boolean((generalCapabilities?.typing_simulation) ?? true);

  const { leadId, conversationId, userMessageId } = await ensureLeadContext(admin, agentId, userMessage);
  const [conversationStateResult, leadStateResult, leadFunnelStateResult] = await Promise.all([
    conversationId
      ? admin.from('conversations').select('current_funnel_step').eq('id', conversationId).maybeSingle()
      : Promise.resolve({ data: null as { current_funnel_step?: string | null } | null }),
    leadId
      ? admin.from('leads').select('attributes').eq('id', leadId).maybeSingle()
      : Promise.resolve({ data: null as { attributes?: Record<string, unknown> | null } | null }),
    leadId
      ? admin.from('lead_funnel_state').select('pending_script_node_id, pending_script_reply').eq('lead_id', leadId).eq('agent_id', agentId).maybeSingle()
      : Promise.resolve({ data: null as { pending_script_node_id?: unknown; pending_script_reply?: unknown } | null }),
  ]);
  const conversationState = conversationStateResult.data;
  const leadState = leadStateResult.data;
  const leadFunnelState = leadFunnelStateResult.data as { pending_script_node_id?: unknown; pending_script_reply?: unknown } | null;
  const persistedNodeId = typeof (leadState?.attributes as Record<string, unknown> | null)?.current_node_id === 'string'
    ? (leadState?.attributes as Record<string, unknown>).current_node_id
    : null;
  const pendingScriptNodeId = typeof leadFunnelState?.pending_script_node_id === 'string'
    ? leadFunnelState.pending_script_node_id
    : null;
  const pendingScriptReply = typeof leadFunnelState?.pending_script_reply === 'string'
    ? leadFunnelState.pending_script_reply
    : null;
  const flow = normalizeFunnelFlow(agent.dialogue_flow);
  const entryNodeId = flow?.entryNodeId ?? null;
  let currentNodeId = conversationState?.current_funnel_step ?? persistedNodeId ?? entryNodeId ?? null;
  const bypassStyleValidation = shouldBypassStyleValidation(agent.dialogue_flow, currentNodeId);

  if (conversationId && !conversationState?.current_funnel_step && entryNodeId) {
    await admin.from('conversations').update({ current_funnel_step: entryNodeId }).eq('id', conversationId);
  }

  const toolContext: ToolContext = {
    leadId: leadId ?? '',
    agentId,
    orgId: agent.org_id ?? '',
    conversationId: conversationId ?? '',
    isSandbox: true,
  };

  const scriptTurnResolution = await handleScriptNodeTurn({
    admin,
    agentId,
    leadId: leadId ?? null,
    conversationId: conversationId ?? null,
    flow,
    currentFunnelStep: currentNodeId,
    pendingScriptNodeId,
    pendingScriptReply,
    userMessage,
    routeExecutor: applyFunnelRouting,
    sendScriptImpl: async () => undefined,
  });

  if (scriptTurnResolution.shouldRoutePendingReply) {
    currentNodeId = scriptTurnResolution.currentFunnelStep ?? currentNodeId;
  }

  const baseContents: Array<Record<string, unknown>> = [
    ...buildChatHistory(history),
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  const generationConfig = {
    temperature: typeof agent.temperature === 'number' ? agent.temperature : 0.7,
    topP: typeof agent.top_p === 'number' ? agent.top_p : 0.9,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    thinkingConfig: { thinkingBudget: 256 },
  } as Record<string, unknown>;

  // === PHASE B SECTION 2.4: Script vs Dynamic split (Call A) ===
  // Check if current funnel node is a script-type message
  const currentDialogueNode = getDialogueNode(flow, currentNodeId);
  const isScriptMessage = currentDialogueNode?.message_type === 'script';

  if (isScriptMessage && Array.isArray(currentDialogueNode?.script_parts) && currentDialogueNode.script_parts.length > 0) {
    // Call A (Script path): Send script_parts directly without Gemini
    console.log(`[SCRIPT_PATH] Agent ${agentId}: sending pre-written script parts from node ${currentNodeId}`);

    const typingSimulation = Boolean((generalCapabilities?.typing_simulation) ?? true);
    const messageParts = handleScriptMessageParts(currentDialogueNode.script_parts, typingSimulation);
    const finalAnswer = messageParts.map((part) => part.text).join('\n\n');

    // Save script message
    const assistantMessageId = await appendMessage(admin, conversationId, 'ai', finalAnswer, []);

    // Persist pending script state so следующий клиентский ответ может быть правильно маршрутизирован.
    if (leadId) {
      await upsertLeadFunnelState(admin, leadId, agentId, {
        currentNodeId: currentNodeId,
        status: 'active',
        isNoMatch: false,
        lastTransitionAt: new Date().toISOString(),
        pendingScriptNodeId: currentNodeId,
        pendingScriptReply: finalAnswer,
      });
    }

    // Log the script call (non-blocking)
    try {
      await admin.from('ai_call_logs').insert({
        conversation_id: conversationId,
        request: {
          type: 'script_message',
          agent_id: agentId,
          node_id: currentNodeId,
          script_parts_count: currentDialogueNode.script_parts.length,
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
      usedChunks: [],
      messageParts,
      splitMessages: false,
      typingSimulation,
      toolsUsed: [],
      tokensInput: 0,
      tokensOutput: 0,
      latencyMs: Date.now() - startTime,
    };
  }
  // === End Script Path ===

  let lastFinishReason: string | undefined = undefined;

  let response = await callGemini(agent.model ?? GEMINI_CHAT_MODEL, compiledPrompt, baseContents, allowedToolDeclarations, undefined, generationConfig);
  lastFinishReason = response.payload.finishReason as string | undefined;
  let parts = response.payload.parts;
  let toolsUsed: string[] = [];
  let iterations = 0;
  let retryContents = baseContents;
  let searchLookupCount = 0;
  let handoffTriggered = false;
  let finalReply = '';
  let fallbackReason: string | null = null;
  let forcedFinalization = false;
  let accumulatedToolResults: Array<Record<string, unknown>> = [];
  let validationAttempted = false;
  let toolResults: Array<Record<string, unknown>> = [];

  while (iterations < 5) {
    const functionCalls = extractToolCalls(parts as Array<Record<string, unknown>> | undefined);
    if (functionCalls.length === 0) break;

    iterations += 1;

    toolResults = [] as Array<Record<string, unknown>>;
    for (const call of functionCalls) {
      if (!allowedToolNames.includes(call.name)) {
        const message = `Инструмент ${call.name} не разрешён для этого агента.`;
        console.warn(`[AGENT] unauthorized tool call`, { agentId, conversationId, call: call.name, userMessage, message });
        toolResults.push({ name: call.name, result: null, error: message });
        continue;
      }

      if (call.name === 'searchKnowledgeBase') {
        searchLookupCount += 1;
        if (searchLookupCount > 3) {
          forcedFinalization = true;
          fallbackReason = 'Сейчас уточню информацию и вернусь с ответом.';
          toolResults.push({ name: call.name, result: null, error: 'Search lookup limit exceeded' });
          break;
        }
      }

      toolsUsed.push(call.name);
      console.log('[TOOL] calling', { agentId, conversationId, name: call.name, args: call.args, trigger: 'model function call' });
      const toolResult = await executeTool(call, toolContext);
      toolResults.push({ name: call.name, args: call.args, result: toolResult.result, error: toolResult.error });
      // accumulate across iterations for possible forced finalization
      accumulatedToolResults.push({ name: call.name, result: toolResult.result, error: toolResult.error });

      if (call.name === 'redirectToOperator' && toolResult.result && !toolResult.error) {
        handoffTriggered = true;
        const redirectMessage = typeof toolResult.result === 'object' && toolResult.result && 'message' in toolResult.result
          ? String((toolResult.result as Record<string, unknown>).message ?? '')
          : '';
        finalReply = redirectMessage || finalReply || 'Сейчас подключу коллегу, пожалуйста, подождите.';
        break;
      }
    }

    if (fallbackReason || handoffTriggered) {
      break;
    }

    if (userMessageId) {
      await admin.from('messages').update({ tool_calls: toolResults }).eq('id', userMessageId);
    }

    const functionResponseParts = toolResults.map((result) => ({
      functionResponse: {
        name: result.name,
        response: result.error ? { error: result.error } : { result: result.result },
      },
    }));

    retryContents = buildRetryContents(baseContents, parts as Array<Record<string, unknown>> | undefined, functionResponseParts);
    response = await callGemini(agent.model ?? GEMINI_CHAT_MODEL, compiledPrompt, retryContents, allowedToolDeclarations, undefined, generationConfig);
    lastFinishReason = response.payload.finishReason as string | undefined;
    parts = response.payload.parts;
  }

  finalReply = (parts as Array<Record<string, unknown>>).filter((part) => typeof part?.text === 'string').map((part) => part.text).join('\n').trim();
  let rawReply = finalReply;
  let attempt = 1;
  let tokens_input = response.payload.usageMetadata?.promptTokenCount ?? 0;
  let tokens_output = response.payload.usageMetadata?.candidatesTokenCount ?? 0;
  let validationErrors: string[] = [];

  if (fallbackReason) {
    // when fallbackReason is set we prefer to perform forced-finalization:
    // call Gemini one final time WITHOUT tools, providing accumulated tool results
    if (forcedFinalization) {
      try {
        const summarizedToolParts: Array<{ text: string }> = [];
        for (const r of accumulatedToolResults) {
          try {
            if (r?.name === 'searchKnowledgeBase' && r?.result && typeof r.result === 'object' && Array.isArray((r.result as any).results)) {
              const res = (r.result as any).results as Array<any>;
              const previews = res.slice(0, 3).map((s) => s.content?.slice(0, 800) ?? '').filter(Boolean);
              if (previews.length > 0) {
                summarizedToolParts.push({ text: `Search results (${r.name}):\n${previews.join('\n---\n')}` });
                continue;
              }
            }
            summarizedToolParts.push({ text: `${r?.name}: ${JSON.stringify(r?.result)}` });
          } catch (e) {
            summarizedToolParts.push({ text: `${r?.name}: <unserializable result>` });
          }
        }

        const finalContents = [
          ...baseContents,
          { role: 'model', parts },
          { role: 'user', parts: [
            { text: `Клиент спрашивает: ${userMessage}` },
            ...summarizedToolParts,
            { text: 'Сформулируй ответ клиенту на основе уже найденной информации выше, в human-tone, без упоминания поиска, лимитов или инструментов. Убедись, что ответ законченный и не обрывается на середине предложения. Не используй списки и отвечай одним коротким сообщением.' },
          ] },
        ];

        const finalGenerationConfig = {
          ...(generationConfig as any),
          maxOutputTokens: Math.max((generationConfig as any)?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS, 1024),
        };
        const finalResponse = await callGemini(agent.model ?? GEMINI_CHAT_MODEL, compiledPrompt, finalContents, [], undefined, finalGenerationConfig);
        lastFinishReason = finalResponse.payload.finishReason as string | undefined;
        const finalParts = finalResponse.payload.parts;
        const finalText = (finalParts as Array<Record<string, unknown>>).filter((part) => typeof part?.text === 'string').map((part) => part.text).join('\n').trim();
        if (finalText) {
          finalReply = finalText;
          rawReply = finalText;
          // override tokens metrics for finalization
          tokens_input += finalResponse.payload.usageMetadata?.promptTokenCount ?? 0;
          tokens_output += finalResponse.payload.usageMetadata?.candidatesTokenCount ?? 0;
        } else {
          finalReply = fallbackReason;
        }
      } catch (e) {
        console.warn('[AGENT] forced finalization failed', e);
        finalReply = fallbackReason;
      }
    } else {
      finalReply = fallbackReason;
    }
  }

  if (handoffTriggered) {
    finalReply = finalReply || 'Сейчас подключу коллегу, пожалуйста, подождите.';
  }

  const READONLY_TOOLS = ['searchKnowledgeBase', 'getCurrentDate', 'getMediaFiles'];
  const usedMutatingTool = toolsUsed.some((name) => !READONLY_TOOLS.includes(name));

  if (!finalReply.trim() && !handoffTriggered && usedMutatingTool) {
    console.warn('[AGENT] empty reply after mutating tool call, retrying WITHOUT tools', { agentId, conversationId, userMessage, toolsUsed });
    try {
      const noToolsContents = [
        ...baseContents,
        { role: 'user', parts: [{ text: `Ответь клиенту на его вопрос обычным текстом: "${userMessage}". Не вызывай никакие инструменты, просто ответь по существу на основе того, что тебе уже известно.` }] },
      ];
      const noToolsResponse = await callGemini(agent.model ?? GEMINI_CHAT_MODEL, compiledPrompt, noToolsContents, [], undefined, generationConfig);
      const noToolsParts = noToolsResponse.payload.parts;
      const noToolsReply = (noToolsParts as Array<Record<string, unknown>>).filter((part) => typeof part?.text === 'string').map((part) => part.text).join('\n').trim();
      if (noToolsReply) {
        finalReply = noToolsReply;
        rawReply = noToolsReply;
        response = noToolsResponse;
        tokens_input += noToolsResponse.payload.usageMetadata?.promptTokenCount ?? 0;
        tokens_output += noToolsResponse.payload.usageMetadata?.candidatesTokenCount ?? 0;
        lastFinishReason = noToolsResponse.payload.finishReason as string | undefined;
      }
    } catch (noToolsErr) {
      console.warn('[AGENT] no-tools retry failed', { agentId, conversationId, error: noToolsErr instanceof Error ? noToolsErr.message : String(noToolsErr) });
    }
  }

  if (!finalReply.trim() && !handoffTriggered) {
    console.warn('[AGENT] empty reply returned by Gemini, retrying once', { agentId, conversationId, userMessage });
    try {
      const retryResponse = await callGemini(agent.model ?? GEMINI_CHAT_MODEL, compiledPrompt, retryContents, allowedToolDeclarations, undefined, generationConfig);
      lastFinishReason = retryResponse.payload.finishReason as string | undefined;
      const retryParts = retryResponse.payload.parts;
      const retryReply = (retryParts as Array<Record<string, unknown>>).filter((part) => typeof part?.text === 'string').map((part) => part.text).join('\n').trim();
      if (retryReply) {
        finalReply = retryReply;
        rawReply = retryReply;
        response = retryResponse;
        attempt = 2;
        tokens_input += retryResponse.payload.usageMetadata?.promptTokenCount ?? 0;
        tokens_output += retryResponse.payload.usageMetadata?.candidatesTokenCount ?? 0;
      } else {
        console.warn('[AGENT] retry also produced an empty reply', { agentId, conversationId, userMessage });
      }
    } catch (retryErr) {
      console.warn('[AGENT] empty-reply retry failed', { agentId, conversationId, userMessage, error: retryErr instanceof Error ? retryErr.message : String(retryErr) });
    }
  }

  if (!finalReply) {
    const fallbackOutcome = await resolveFallbackReply(admin, agentId, allowedToolNames, toolContext, 'Пустой ответ модели после обработки инструментов');
    finalReply = fallbackOutcome.reply;
    handoffTriggered = handoffTriggered || fallbackOutcome.handoffTriggered;
    await logErrorIncident(admin, agentId, { reason: 'empty_response', message: userMessage, attempt, tool_calls: toolsUsed });
  }

  let validation = { valid: true, errors: [] as string[] };
  if (!bypassStyleValidation) {
    validation = validateAgentAnswer(finalReply);
    validationErrors = validation.valid ? [] : validation.errors;
  } else {
    validationErrors = [];
  }

  const shouldKeepCurrentReply = Boolean(finalReply?.trim()) && !shouldUseFallbackReply(validationErrors, finalReply);
  if (!validation.valid && !validationAttempted && !bypassStyleValidation && !shouldKeepCurrentReply) {
    validationAttempted = true;
    console.warn('[AGENT] validation failed, retrying once', { agentId, errors: validation.errors });
    const retryResponse = await callGemini(agent.model ?? GEMINI_CHAT_MODEL, compiledPrompt, retryContents, allowedToolDeclarations, undefined, generationConfig);
    lastFinishReason = retryResponse.payload.finishReason as string | undefined;
    const retryParts = retryResponse.payload.parts;
    const retryReply = (retryParts as Array<Record<string, unknown>>).filter((part) => typeof part?.text === 'string').map((part) => part.text).join('\n').trim();
    const retryValidation = validateAgentAnswer(retryReply);
    attempt = 2;
    rawReply = retryReply;
    tokens_input += retryResponse.payload.usageMetadata?.promptTokenCount ?? 0;
    tokens_output += retryResponse.payload.usageMetadata?.candidatesTokenCount ?? 0;
    validationErrors = retryValidation.valid ? [] : retryValidation.errors;

    if (retryValidation.valid || !shouldUseFallbackReply(validationErrors, retryReply)) {
      finalReply = retryReply;
    } else {
      console.warn('[AGENT] retry validation failed', { agentId, errors: retryValidation.errors });
      const fallbackOutcome = await resolveFallbackReply(admin, agentId, allowedToolNames, toolContext, 'Ошибка валидации после повторной попытки');
      finalReply = fallbackOutcome.reply;
      handoffTriggered = handoffTriggered || fallbackOutcome.handoffTriggered;
      await logErrorIncident(admin, agentId, { reason: 'validation_retry_failed', errors: retryValidation.errors, attempt });
    }
  }

  const routingOutcome = await applyFunnelRouting({
    admin,
    agentId,
    leadId,
    conversationId,
    flow,
    currentNodeId,
    userMessage,
    assistantReply: finalReply,
  });

  const postRoutingReply = resolvePostRoutingReply({
    routingOutcome,
    finalAnswer: finalReply,
    handoffClientMessage: undefined,
  });

  handoffTriggered = handoffTriggered || routingOutcome.shouldHandoff;
  finalReply = postRoutingReply.finalAnswer;

  const assistantMessageId = await appendMessage(admin, conversationId, 'ai', finalReply, toolsUsed.map((name) => ({ name })));

  await admin.from('ai_call_logs').insert({
    conversation_id: conversationId,
    request: {
      agent_id: agentId,
      message: userMessage,
      tools_used: toolsUsed,
      tool_calls_detail: toolResults,
      iterations,
      validation_errors: validationErrors,
      attempt,
      routing: routingOutcome,
    },
    response: {
      raw: rawReply,
      final: finalReply,
      finish_reason: lastFinishReason ?? null,
      usage_metadata: response?.payload?.usageMetadata ?? null,
    },
    tokens_input,
    tokens_output,
    latency_ms: Date.now() - startTime,
  });

  const splitMessages = Boolean((generalCapabilities?.split_messages) ?? true);
  const splitMaxParts = Math.min(3, Math.max(1, Number(generalCapabilities?.split_max_parts ?? 3)));
  const messageParts = splitAgentMessage(finalReply, splitMessages, splitMaxParts).map((part) => ({
    text: part.text,
    delayMs: typingSimulation ? calculateTypingDelay(part.text) + part.delayMs : part.delayMs,
  }));

  return {
    answer: finalReply,
    usedChunks: [],
    messageParts,
    splitMessages,
    typingSimulation,
    toolsUsed,
    tokensInput: response.payload.usageMetadata?.promptTokenCount ?? 0,
    tokensOutput: response.payload.usageMetadata?.candidatesTokenCount ?? 0,
    latencyMs: Date.now() - startTime,
    finishReason: lastFinishReason,
  };
}
