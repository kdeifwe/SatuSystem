export interface FunnelNodeLike {
  id?: string | null;
  title?: string | null;
}

export interface FunnelFlowLike {
  entryNodeId?: string | null;
  nodes?: FunnelNodeLike[] | null;
}

export interface DurableFunnelStateLike {
  currentFunnelStep?: string | null;
  currentNodeId?: string | null;
  pendingNodeId?: string | null;
}

export interface BackfillMessageLike {
  role?: string | null;
  sender?: string | null;
  content?: string | null;
  tool_calls?: unknown;
}

function getEntryNodeId(flow: FunnelFlowLike | null | undefined): string | null {
  if (flow?.entryNodeId) return flow.entryNodeId;

  if (Array.isArray(flow?.nodes) && flow.nodes.length > 0) {
    return flow.nodes[0]?.id ?? null;
  }

  return null;
}

function extractNodeIdFromToolCalls(toolCalls: unknown): string | null {
  if (!Array.isArray(toolCalls)) return null;

  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const entry = toolCalls[index];
    if (!entry || typeof entry !== 'object') continue;

    const record = entry as Record<string, any>;
    const isAdvanceFunnelTool = record.name === 'advanceFunnelStep' || record.tool_name === 'advanceFunnelStep';
    if (!isAdvanceFunnelTool) continue;

    const resultPayload = record.result && typeof record.result === 'object' ? record.result as Record<string, any> : null;
    const directResultStepId = typeof resultPayload?.step_id === 'string' && resultPayload.step_id.trim()
      ? resultPayload.step_id
      : typeof resultPayload?.stepId === 'string' && resultPayload.stepId.trim()
        ? resultPayload.stepId
        : null;

    if (directResultStepId) return directResultStepId;

    const payload = record.args ?? record.arguments ?? record.input ?? {};
    const stepId = typeof payload?.stepId === 'string' && payload.stepId.trim()
      ? payload.stepId
      : typeof payload?.step_id === 'string' && payload.step_id.trim()
        ? payload.step_id
        : null;

    if (stepId) return stepId;
  }

  return null;
}

export function inferCurrentNodeIdFromMessages(
  messages: BackfillMessageLike[] | null | undefined,
  funnelFlow: FunnelFlowLike | null | undefined,
  durableState?: DurableFunnelStateLike | null,
): string | null {
  const durableNodeId = [durableState?.currentFunnelStep, durableState?.currentNodeId, durableState?.pendingNodeId]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0);

  if (durableNodeId) {
    return durableNodeId;
  }

  const entryNodeId = getEntryNodeId(funnelFlow) ?? 'n1';

  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }

  const directNodeId = messages
    .slice()
    .reverse()
    .map((message) => extractNodeIdFromToolCalls(message.tool_calls))
    .find((value): value is string => Boolean(value));

  if (directNodeId) {
    return directNodeId;
  }

  const nodes = (funnelFlow?.nodes || [])
    .map((node) => node?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .sort();

  if (nodes.length === 0) {
    return entryNodeId;
  }

  const assistantMessages = messages.filter((message) => {
    const role = ((message.role ?? message.sender ?? '') as string).toLowerCase();
    return role === 'assistant' || role === 'model' || role === 'ai' || role === 'system';
  });

  const estimatedDepth = Math.min(assistantMessages.length, Math.max(0, nodes.length - 1));
  return nodes[estimatedDepth] || nodes[nodes.length - 1] || entryNodeId;
}
