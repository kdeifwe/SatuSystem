import assert from 'node:assert/strict';
import test from 'node:test';

test('applyFunnelRouting is passive and preserves current funnel step', async () => {
  const rpcCalls: Array<Record<string, unknown>> = [];
  const admin = {
    rpc: async (_name: string, params: Record<string, unknown>) => {
      rpcCalls.push(params);
      return { data: [{ id: 'state-1', retry_count: 0 }], error: null };
    },
  };

  const { applyFunnelRouting } = await import('../lib/funnel/routing.ts');

  const flow = {
    entryNodeId: 'greeting',
    nodes: [
      { id: 'greeting', title: 'Greeting', content: 'Привет! Как вас зовут?' },
    ],
  };

  const result = await applyFunnelRouting({
    admin,
    agentId: 'agent-1',
    leadId: 'lead-1',
    conversationId: 'conversation-1',
    flow: flow as any,
    currentNodeId: 'greeting',
    userMessage: 'Кыдыр',
    assistantReply: 'Привет! Как вас зовут?',
  });

  assert.equal(result.skippedClassifier, true);
  assert.equal(result.shouldHandoff, false);
  assert.equal(result.targetNodeId, null);
  assert.equal(result.condition, null);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].p_status, 'active');
  assert.equal(rpcCalls[0].p_is_no_match, false);
});

test('applyFunnelRouting returns no-op when funnel context is missing', async () => {
  const admin = { rpc: async () => ({ data: null, error: null }) };
  const { applyFunnelRouting } = await import('../lib/funnel/routing.ts');

  const result = await applyFunnelRouting({
    admin,
    agentId: 'agent-1',
    leadId: null,
    conversationId: 'conversation-1',
    flow: null,
    currentNodeId: null,
    userMessage: 'Кыдыр',
    assistantReply: 'Привет!',
  });

  assert.equal(result.skippedClassifier, true);
  assert.equal(result.shouldHandoff, false);
  assert.equal(result.targetNodeId, null);
  assert.equal(result.condition, null);
});

test('resolvePostRoutingReply handles handoff and duplicate handoff responses', async () => {
  const { resolvePostRoutingReply } = await import('../lib/funnel/routing.ts');

  const handoffReply = resolvePostRoutingReply({
    routingOutcome: { shouldHandoff: true, duplicateHandoffSkipped: false },
    finalAnswer: 'Оригинальный ответ',
    handoffClientMessage: 'Подключаю сотрудника',
  });

  assert.equal(handoffReply.finalAnswer, 'Подключаю сотрудника');
  assert.equal(handoffReply.shouldAppendMessage, true);

  const duplicateReply = resolvePostRoutingReply({
    routingOutcome: { shouldHandoff: false, duplicateHandoffSkipped: true },
    finalAnswer: 'Оригинальный ответ',
    handoffClientMessage: 'Подключаю сотрудника',
  });

  assert.equal(duplicateReply.finalAnswer, '');
  assert.equal(duplicateReply.shouldAppendMessage, false);
});
