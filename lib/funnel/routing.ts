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

export interface ApplyRoutingArgs {
  admin: any;
  agentId: string;
  leadId: string | null;
  conversationId: string | null;
  flow: FunnelFlow | null;
  currentNodeId: string | null;
  userMessage: string;
  assistantReply: string;
  executeToolImpl?: (call: { name: string; args: Record<string, unknown> }, context: { leadId: string; agentId: string; orgId: string; conversationId: string; isSandbox: boolean }) => Promise<unknown>;
}

export interface ApplyRoutingResult {
  skippedClassifier: boolean;
  condition: string | null;
  targetNodeId: string | null;
  shouldHandoff: boolean;
  classifierResult?: null;
  handoffExecuted?: boolean;
  duplicateHandoffSkipped?: boolean;
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

  const node = args.flow.nodes?.find((candidate) => candidate.id === args.currentNodeId) as FunnelNodeWithRouting | undefined;
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

  await upsertLeadFunnelState(args.admin, args.leadId, args.agentId, {
    currentNodeId: args.currentNodeId,
    status: 'active',
    isNoMatch: false,
    lastTransitionAt: new Date().toISOString(),
  });

  return {
    skippedClassifier: true,
    condition: null,
    targetNodeId: null,
    shouldHandoff: false,
    classifierResult: null,
    handoffExecuted: false,
  };
}

export interface PostRoutingReply {
  finalAnswer: string;
  shouldAppendMessage: boolean;
}

export function resolvePostRoutingReply(args: {
  routingOutcome: ApplyRoutingResult;
  finalAnswer: string;
  handoffClientMessage?: string | undefined;
}): PostRoutingReply {
  if (args.routingOutcome.shouldHandoff) {
    return {
      finalAnswer: args.handoffClientMessage ?? args.finalAnswer,
      shouldAppendMessage: true,
    };
  }

  if (args.routingOutcome.duplicateHandoffSkipped) {
    return {
      finalAnswer: '',
      shouldAppendMessage: false,
    };
  }

  return {
    finalAnswer: args.finalAnswer,
    shouldAppendMessage: false,
  };
}

export function buildRoutingRequestBody(node: FunnelNodeWithRouting, userMessage: string, assistantReply: string) {
  return {
    prompt: `Node: ${node.title || node.id}\nMessage: ${userMessage}\nReply: ${assistantReply}`,
    generationConfig: {
      thinkingConfig: {
        thinkingBudget: 0,
      },
    },
  };
}
