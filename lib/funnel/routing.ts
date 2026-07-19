import { geminiFetch, GEMINI_CHAT_MODEL } from '../server/ai/gemini-client.ts';
import { buildGeminiObjectSchema } from '../server/ai/gemini-response-schema.ts';
import { executeTool } from '../ai/tools/executor.ts';
import { isSandboxLeadAttributes } from '../ai/sandbox-context.ts';
import type { FunnelFlow, FunnelNode } from './types.ts';

export interface FunnelTransitionLike {
  condition?: string | null;
  target?: string | null;
}

export interface FunnelNodeWithRouting extends FunnelNode {
  transitions?: FunnelTransitionLike[];
  fallback_condition?: string | null;
  fallback_target?: string | null;
  max_retries_before_handoff?: number | null;
  extract_fields?: string[];
}

export interface RoutingClassifierResult {
  condition: string;
  confidence?: number;
  usageMetadata?: {
    promptTokenCount?: number | null;
    candidatesTokenCount?: number | null;
    totalTokenCount?: number | null;
  } | null;
  latencyMs?: number | null;
  model?: string | null;
}

export interface RoutingDecision {
  shouldSkipClassifier: boolean;
  condition: string;
  targetNodeId: string | null;
  shouldHandoff: boolean;
}

export interface ResolveRoutingDecisionArgs {
  node: FunnelNodeWithRouting;
  classifierResult: RoutingClassifierResult | null | undefined;
  noMatchRetryCount: number;
}

export interface ApplyRoutingArgs {
  admin: any;
  agentId: string;
  leadId: string | null;
  conversationId: string | null;
  flow: FunnelFlow | null;
  currentNodeId: string | null;
  userMessage: string;
  assistantReply: string;
  classifier?: (node: FunnelNodeWithRouting, userMessage: string, assistantReply: string) => Promise<RoutingClassifierResult>;
  executeToolImpl?: (call: { name: string; args: Record<string, unknown> }, context: { leadId: string; agentId: string; orgId: string; conversationId: string; isSandbox: boolean }) => Promise<unknown>;
}

export interface ApplyRoutingResult {
  skippedClassifier: boolean;
  condition: string | null;
  targetNodeId: string | null;
  shouldHandoff: boolean;
  classifierResult?: RoutingClassifierResult | null;
  handoffExecuted?: boolean;
  duplicateHandoffSkipped?: boolean;
}

export interface RetryStateOutcome {
  retryCount: number;
  shouldHandoff: boolean;
}

function normalizeCondition(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractText(response: Record<string, unknown>): string {
  const candidates = Array.isArray((response as any)?.candidates) ? (response as any).candidates : [];
  const parts = Array.isArray(candidates[0]?.content?.parts) ? candidates[0].content.parts : [];
  return parts
    .filter((part: Record<string, unknown>) => typeof part?.text === 'string')
    .map((part: Record<string, unknown>) => part.text)
    .join('\n')
    .trim();
}

function buildRoutingSchema(transitions: FunnelTransitionLike[]): Record<string, unknown> {
  const conditionValues = Array.from(new Set([
    ...transitions.map((transition) => normalizeCondition(transition.condition)).filter((condition): condition is string => Boolean(condition)),
    'answers_received',
    'no_match',
  ])).sort();

  return buildGeminiObjectSchema({
    condition: {
      type: 'string',
      enum: conditionValues,
    },
    confidence: {
      type: 'number',
    },
  }, ['condition']);
}

function buildRoutingPrompt(node: FunnelNodeWithRouting, userMessage: string, assistantReply: string): string {
  const transitions = Array.isArray(node.transitions) ? node.transitions : [];
  const transitionSummary = transitions.length > 0
    ? transitions.map((transition) => `${normalizeCondition(transition.condition) ?? 'unknown'} -> ${transition.target ?? 'unknown'}`).join('; ')
    : 'нет явных переходов';
  const fallbackSummary = node.fallback_target
    ? `${node.fallback_condition ?? 'no_match'} -> ${node.fallback_target}`
    : 'нет fallback-перехода';
  const fieldHints = Array.isArray(node.extract_fields) && node.extract_fields.length > 0
    ? `Поля узла, которые нужно получить: ${node.extract_fields.join(', ')}`
    : 'Поля узла: не заданы';

  return [
    'Ты — routing-классификатор для FSM-воронки продаж.',
    'На основе последнего сообщения клиента и текущего состояния узла определи, какой переход выбрать.',
    `Текущий узел: ${node.id} (${node.title ?? 'без названия'})`,
    `Текст узла: ${node.content ?? ''}`,
    fieldHints,
    `Доступные переходы: ${transitionSummary}`,
    `Fallback: ${fallbackSummary}`,
    `Последнее сообщение клиента: ${userMessage}`,
    `Последний ответ агента: ${assistantReply}`,
    'Ключевое правило: если клиент дал явный ответ на вопросы текущего шага (имя, класс, предметы, желание учиться, ЕНТ, контакт, цену и т.п.), выбирай condition: "answers_received" и НЕ "no_match".',
    'Пример: "Аня, 10 класс, хочу на ЕНТ" -> answers_received.',
    'Если клиент лишь задаёт вопрос, не даёт нужных данных или не отвечает по сути текущего шага, верни "no_match".',
    'Ответ только валидным JSON без комментариев.',
  ].join('\n');
}

// Note: heuristic inference removed to keep routing decision strictly driven
// by the routing-classifier LLM call as required by Phase B design.

export function buildRoutingRequestBody(node: FunnelNodeWithRouting, userMessage: string, assistantReply: string) {
  return {
    system_instruction: { parts: [{ text: 'Ты — routing-классификатор, отвечай только JSON.' }] },
    contents: [{ role: 'user', parts: [{ text: buildRoutingPrompt(node, userMessage, assistantReply) }] }],
    generationConfig: {
      temperature: 0.05,
      topP: 0.8,
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
      responseSchema: buildRoutingSchema(Array.isArray(node.transitions) ? node.transitions : []),
    },
  } as const;
}

export function deriveRetryState({
  previousRetryCount,
  decision,
  threshold,
}: {
  previousRetryCount: number;
  decision: RoutingDecision;
  threshold: number | null;
}): RetryStateOutcome {
  if (decision.targetNodeId) {
    return {
      retryCount: 0,
      shouldHandoff: false,
    };
  }

  if (decision.shouldHandoff) {
    return {
      retryCount: previousRetryCount + 1,
      shouldHandoff: true,
    };
  }

  const nextRetryCount = previousRetryCount + 1;
  return {
    retryCount: nextRetryCount,
    shouldHandoff: Boolean(threshold !== null && threshold > 0 && nextRetryCount >= threshold),
  };
}

export function resolveRoutingDecision(args: ResolveRoutingDecisionArgs): RoutingDecision {
  const node = args.node;
  const transitions = Array.isArray(node.transitions) ? node.transitions : [];
  const hasSingleDefaultTransition = transitions.length === 1 && normalizeCondition(transitions[0]?.condition) === 'default';

  if (hasSingleDefaultTransition && transitions[0]?.target) {
    return {
      shouldSkipClassifier: true,
      condition: 'default',
      targetNodeId: transitions[0]?.target ?? null,
      shouldHandoff: false,
    };
  }

  const classifierCondition = normalizeCondition(args.classifierResult?.condition) ?? 'no_match';
  const fallbackCondition = normalizeCondition(node.fallback_condition) ?? 'no_match';
  const fallbackTarget = typeof node.fallback_target === 'string' && node.fallback_target.trim().length > 0
    ? node.fallback_target.trim()
    : null;
  const threshold = typeof node.max_retries_before_handoff === 'number' ? node.max_retries_before_handoff : null;

  if (threshold === null) {
    console.warn('[Funnel] max_retries_before_handoff is missing or invalid, disabling handoff threshold', {
      nodeId: node.id,
      title: node.title,
    });
  }

  if (classifierCondition === 'no_match') {
    if (fallbackCondition === 'no_match' && fallbackTarget) {
      if (threshold !== null && threshold > 0 && args.noMatchRetryCount >= threshold) {
        return {
          shouldSkipClassifier: false,
          condition: 'no_match',
          targetNodeId: null,
          shouldHandoff: true,
        };
      }

      return {
        shouldSkipClassifier: false,
        condition: 'no_match',
        targetNodeId: fallbackTarget,
        shouldHandoff: false,
      };
    }

    return {
      shouldSkipClassifier: false,
      condition: 'no_match',
      targetNodeId: null,
      shouldHandoff: false,
    };
  }

  const matchedTransition = transitions.find((transition) => normalizeCondition(transition.condition) === classifierCondition);
  if (matchedTransition?.target) {
    return {
      shouldSkipClassifier: false,
      condition: classifierCondition,
      targetNodeId: matchedTransition.target,
      shouldHandoff: false,
    };
  }

  if (fallbackCondition === 'no_match' && fallbackTarget) {
    return {
      shouldSkipClassifier: false,
      condition: classifierCondition,
      targetNodeId: fallbackTarget,
      shouldHandoff: false,
    };
  }

  return {
    shouldSkipClassifier: false,
    condition: classifierCondition,
    targetNodeId: null,
    shouldHandoff: false,
  };
}

export function resolvePostRoutingReply(params: {
  routingOutcome: Pick<ApplyRoutingResult, 'shouldHandoff' | 'duplicateHandoffSkipped'>;
  finalAnswer: string;
  handoffClientMessage?: string | null;
}): { finalAnswer: string; shouldAppendMessage: boolean } {
  if (params.routingOutcome.shouldHandoff) {
    return {
      finalAnswer: params.handoffClientMessage?.trim() || 'Подключаю сотрудника, он уже видит наш диалог',
      shouldAppendMessage: true,
    };
  }

  if (params.routingOutcome.duplicateHandoffSkipped) {
    return {
      finalAnswer: '',
      shouldAppendMessage: false,
    };
  }

  return {
    finalAnswer: params.finalAnswer,
    shouldAppendMessage: true,
  };
}

function extractUsageMetadata(payload: Record<string, unknown> | null | undefined) {
  const usageMetadata = (payload as Record<string, unknown> | null | undefined)?.usageMetadata ?? (payload as Record<string, unknown> | null | undefined)?.usage_metadata;
  if (!usageMetadata || typeof usageMetadata !== 'object') {
    return null;
  }

  const promptTokenCount = Number((usageMetadata as Record<string, unknown>).promptTokenCount ?? (usageMetadata as Record<string, unknown>).prompt_token_count ?? 0);
  const candidatesTokenCount = Number((usageMetadata as Record<string, unknown>).candidatesTokenCount ?? (usageMetadata as Record<string, unknown>).candidates_token_count ?? 0);
  const totalTokenCount = Number((usageMetadata as Record<string, unknown>).totalTokenCount ?? (usageMetadata as Record<string, unknown>).total_token_count ?? 0);

  return {
    promptTokenCount: Number.isFinite(promptTokenCount) ? promptTokenCount : null,
    candidatesTokenCount: Number.isFinite(candidatesTokenCount) ? candidatesTokenCount : null,
    totalTokenCount: Number.isFinite(totalTokenCount) ? totalTokenCount : null,
  };
}

async function classifyTransition(node: FunnelNodeWithRouting, userMessage: string, assistantReply: string): Promise<RoutingClassifierResult> {
  console.log('[Funnel][routing-node-debug]', {
    nodeId: node.id,
    title: node.title,
    transitions: Array.isArray(node.transitions) ? node.transitions : [],
    userMessage,
    assistantReply,
  });

  // Heuristic inference removed; always call the routing-classifier LLM.

  let requestBody = buildRoutingRequestBody(node, userMessage, assistantReply) as any;

  if (process.env.DEBUG_ROUTING_CLASSIFIER === '1') {
    console.log('[Funnel][routing-classifier-request]', JSON.stringify({
      nodeId: node.id,
      userMessage,
      assistantReply,
      requestBody,
    }, null, 2));
  }

  async function executeCall(retryCount = 0): Promise<string> {
    const response = await geminiFetch(GEMINI_CHAT_MODEL, 'generateContent', requestBody);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Routing classifier error ${response.status}: ${text}`);
    }

    const data = await response.json();
    console.log('[Funnel][routing-classifier-raw-json]', JSON.stringify(data, null, 2));

    const candidate = Array.isArray((data as any)?.candidates) ? (data as any).candidates[0] : undefined;
    const finishReason = candidate?.finishReason ?? candidate?.finish_reason;
    const raw = extractText(data);

    if ((!raw || raw.length === 0) && finishReason === 'MAX_TOKENS' && retryCount === 0) {
      const currentMax = Number(requestBody?.generationConfig?.maxOutputTokens ?? 512);
      const cap = 32768;
      if (currentMax < cap) {
        const nextMax = Math.min(cap, Math.max(currentMax * 2, currentMax + 1024));
        requestBody = {
          ...requestBody,
          generationConfig: {
            ...requestBody.generationConfig,
            maxOutputTokens: nextMax,
          },
        };
        console.warn('[Funnel] routing-classifier: empty candidate with MAX_TOKENS, retrying with nextMax=', nextMax);
        return executeCall(1);
      }
    }

    if (!raw) {
      throw new Error('Routing classifier не вернул структурированный результат');
    }

    return raw;
  }

  const startedAt = Date.now();
  const rawText = await executeCall(0);
  const parsed = JSON.parse(rawText) as Partial<RoutingClassifierResult> & Record<string, unknown>;
  const usageMetadata = extractUsageMetadata(parsed);

  return {
    condition: normalizeCondition(parsed.condition) ?? 'no_match',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
    usageMetadata,
    latencyMs: Date.now() - startedAt,
    model: GEMINI_CHAT_MODEL,
  };
}

export async function upsertLeadFunnelState(
  admin: any,
  leadId: string,
  agentId: string,
  params: {
    currentNodeId: string | null;
    status: string;
    isNoMatch: boolean;
    lastTransitionAt?: string | null;
    pendingScriptNodeId?: string | null;
    pendingScriptReply?: string | null;
  },
) {
  const { data, error } = await admin.rpc('upsert_lead_funnel_state', {
    p_lead_id: leadId,
    p_agent_id: agentId,
    p_current_node_id: params.currentNodeId ?? null,
    p_status: params.status,
    p_is_no_match: params.isNoMatch,
    p_last_transition_at: params.lastTransitionAt ?? new Date().toISOString(),
    p_pending_script_node_id: params.pendingScriptNodeId ?? null,
    p_pending_script_reply: params.pendingScriptReply ?? null,
  });

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data[0] : data ?? null;
}

function getNodeTransitions(node: FunnelNodeWithRouting, flow: FunnelFlow | null | undefined): FunnelTransitionLike[] {
  if (Array.isArray(node.transitions) && node.transitions.length > 0) {
    return node.transitions;
  }

  const outgoingEdges = Array.isArray(flow?.edges)
    ? flow.edges.filter((edge) => edge.from === node.id && typeof edge.to === 'string' && edge.to.trim().length > 0)
    : [];

  if (outgoingEdges.length === 0) {
    return [];
  }

  return outgoingEdges.map((edge) => ({
    condition: /ответ|continue|next/i.test(edge.label ?? '') ? 'answers_received' : 'default',
    target: edge.to,
  }));
}

export async function applyFunnelRouting(args: ApplyRoutingArgs): Promise<ApplyRoutingResult> {
  if (!args.leadId || !args.conversationId || !args.flow || !args.currentNodeId) {
    return {
      skippedClassifier: true,
      condition: null,
      targetNodeId: null,
      shouldHandoff: false,
      classifierResult: null,
      handoffExecuted: false,
    };
  }

  const node = args.flow.nodes.find((candidate) => candidate.id === args.currentNodeId) as FunnelNodeWithRouting | undefined;
  if (!node) {
    return {
      skippedClassifier: true,
      condition: null,
      targetNodeId: null,
      shouldHandoff: false,
      classifierResult: null,
      handoffExecuted: false,
    };
  }

  const transitions = getNodeTransitions(node, args.flow);
  if (transitions.length === 0) {
    return {
      skippedClassifier: true,
      condition: null,
      targetNodeId: null,
      shouldHandoff: false,
      classifierResult: null,
      handoffExecuted: false,
    };
  }

  const hasSingleDefaultTransition = transitions.length === 1 && normalizeCondition(transitions[0]?.condition) === 'default';
  // NOTE: only a node with exactly one transition and that transition being default
  // bypasses the classifier; a node with default plus another transition must still
  // go through the classifier so its other branches remain reachable.
  // classifier and take default. This is a known limitation for malformed flows
  // and is acceptable for current migrated data.
  if (hasSingleDefaultTransition) {
    const targetNodeId = transitions[0]?.target ?? null;
    await persistTransition(args.admin, args.leadId, args.agentId, args.conversationId, args.currentNodeId, targetNodeId, 'default');
    return {
      skippedClassifier: true,
      condition: 'default',
      targetNodeId,
      shouldHandoff: false,
      classifierResult: { condition: 'default' },
      handoffExecuted: false,
    };
  }

  const routingNode = { ...node, transitions } as FunnelNodeWithRouting;

  let classifierResult: RoutingClassifierResult | null = null;
  try {
    classifierResult = args.classifier
      ? await args.classifier(routingNode, args.userMessage, args.assistantReply)
      : await classifyTransition(routingNode, args.userMessage, args.assistantReply);
  } catch (error) {
    console.warn('[Funnel] routing classifier failed, falling back to no_match', error);
    classifierResult = { condition: 'no_match' };
  }

  const initialDecision = resolveRoutingDecision({
    node: routingNode,
    classifierResult,
    noMatchRetryCount: 0,
  });
  const isNoMatch = initialDecision.condition === 'no_match' && !initialDecision.targetNodeId && !initialDecision.shouldHandoff;

  const persistedState = await upsertLeadFunnelState(args.admin, args.leadId, args.agentId, {
    currentNodeId: args.currentNodeId,
    status: 'active',
    isNoMatch,
    lastTransitionAt: new Date().toISOString(),
  });

  const currentRetryCount = typeof persistedState?.retry_count === 'number' ? persistedState.retry_count : 0;
  const currentStateStatus = typeof persistedState?.status === 'string' ? persistedState.status : null;
  const wasAlreadyPaused = Boolean(persistedState?.was_already_paused);
  const decision = resolveRoutingDecision({
    node: routingNode,
    classifierResult,
    noMatchRetryCount: currentRetryCount,
  });

  const threshold = typeof routingNode.max_retries_before_handoff === 'number' ? routingNode.max_retries_before_handoff : null;
  const retryState = {
    retryCount: currentRetryCount,
    shouldHandoff: decision.shouldHandoff,
  };

  if (args.conversationId) {
    await args.admin.from('ai_call_logs').insert({
      conversation_id: args.conversationId,
      model: classifierResult?.model ?? GEMINI_CHAT_MODEL,
      tokens_input: classifierResult?.usageMetadata?.promptTokenCount ?? null,
      tokens_output: classifierResult?.usageMetadata?.candidatesTokenCount ?? null,
      latency_ms: classifierResult?.latencyMs ?? null,
      request: {
        type: 'funnel_routing_classifier',
        lead_id: args.leadId,
        agent_id: args.agentId,
        node_id: args.currentNodeId,
        user_message: args.userMessage,
        assistant_reply: args.assistantReply,
        threshold,
      },
      response: {
        condition: classifierResult?.condition ?? null,
        confidence: classifierResult?.confidence ?? null,
        decision,
        retry_state: retryState,
      },
    });
  }

  if (!decision.targetNodeId && !decision.shouldHandoff) {
    return {
      skippedClassifier: false,
      condition: decision.condition,
      targetNodeId: null,
      shouldHandoff: false,
      classifierResult,
      handoffExecuted: false,
    };
  }

  if (decision.shouldHandoff) {
    if (wasAlreadyPaused) {
      console.warn('[Funnel] skipping duplicate handoff for already paused lead state', {
        leadId: args.leadId,
        agentId: args.agentId,
        currentNodeId: args.currentNodeId,
      });

      return {
        skippedClassifier: false,
        condition: 'no_match',
        targetNodeId: null,
        shouldHandoff: false,
        classifierResult,
        handoffExecuted: false,
        duplicateHandoffSkipped: true,
      };
    }

    await upsertLeadFunnelState(args.admin, args.leadId, args.agentId, {
      currentNodeId: args.currentNodeId,
      status: 'paused',
      isNoMatch: false,
      lastTransitionAt: new Date().toISOString(),
    });

    await args.admin.from('funnel_transitions_log').insert({
      lead_id: args.leadId,
      agent_id: args.agentId,
      from_node_id: args.currentNodeId,
      to_node_id: null,
      condition: 'no_match',
      metadata: {
        reason: 'handoff_after_retries',
        retries: retryState.retryCount,
      },
    });

    const { data: leadData, error: leadError } = await args.admin
      .from('leads')
      .select('org_id,attributes')
      .eq('id', args.leadId)
      .maybeSingle();

    const orgId = leadData?.org_id ?? '';
    const isSandbox = isSandboxLeadAttributes(leadData?.attributes);
    let handoffExecuted = false;

    if (orgId) {
      const toolResult = await (args.executeToolImpl ?? executeTool)(
        {
          name: 'redirectToOperator',
          args: {
            reason: 'funnel_retries_exhausted',
            priority: 'high',
          },
        },
        {
          leadId: args.leadId,
          agentId: args.agentId,
          orgId,
          conversationId: args.conversationId ?? '',
          isSandbox,
        },
      ) as { error?: unknown } | undefined;

      if (!toolResult?.error) {
        handoffExecuted = true;
      } else {
        console.warn('[Funnel] redirectToOperator failed during handoff', {
          leadId: args.leadId,
          agentId: args.agentId,
          error: toolResult.error,
        });
      }
    } else {
      console.warn('[Funnel] cannot execute redirectToOperator: lead org_id missing', { leadId: args.leadId, leadError });
    }

    return {
      skippedClassifier: false,
      condition: 'no_match',
      targetNodeId: null,
      shouldHandoff: true,
      classifierResult,
      handoffExecuted,
    };
  }

  await persistTransition(args.admin, args.leadId, args.agentId, args.conversationId, args.currentNodeId, decision.targetNodeId, decision.condition);
  return {
    skippedClassifier: false,
    condition: decision.condition,
    targetNodeId: decision.targetNodeId,
    shouldHandoff: false,
    classifierResult,
    handoffExecuted: false,
  };
}

async function persistTransition(
  admin: any,
  leadId: string,
  agentId: string,
  conversationId: string,
  fromNodeId: string,
  toNodeId: string | null,
  condition: string,
): Promise<void> {
  await upsertLeadFunnelState(admin, leadId, agentId, {
    currentNodeId: toNodeId ?? fromNodeId,
    status: 'active',
    isNoMatch: false,
    lastTransitionAt: new Date().toISOString(),
  });

  await admin.from('conversations').update({ current_funnel_step: toNodeId ?? fromNodeId }).eq('id', conversationId);

  const { data: leadData } = await admin.from('leads').select('attributes').eq('id', leadId).maybeSingle();
  const currentAttributes = (leadData?.attributes && typeof leadData.attributes === 'object'
    ? leadData.attributes
    : {}) as Record<string, unknown>;

  await admin.from('leads').update({
    attributes: {
      ...currentAttributes,
      current_node_id: toNodeId ?? fromNodeId,
    },
  }).eq('id', leadId);

  await admin.from('funnel_transitions_log').insert({
    lead_id: leadId,
    agent_id: agentId,
    from_node_id: fromNodeId,
    to_node_id: toNodeId,
    condition,
    metadata: { source: 'routing_classifier' },
  });
}
