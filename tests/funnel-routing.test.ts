import assert from 'node:assert/strict';
import test from 'node:test';

test('skips classifier for a node with a single default transition', async () => {
  const { resolveRoutingDecision } = await import('../lib/funnel/routing.ts');
  const decision = resolveRoutingDecision({
    node: {
      id: 'n1',
      transitions: [{ condition: 'default', target: 'n2' }],
      fallback_condition: 'no_match',
      fallback_target: 'n1',
      max_retries_before_handoff: 1,
    },
    classifierResult: { condition: 'no_match' },
    noMatchRetryCount: 0,
  });

  assert.equal(decision.shouldSkipClassifier, true);
  assert.equal(decision.targetNodeId, 'n2');
  assert.equal(decision.condition, 'default');
  assert.equal(decision.shouldHandoff, false);
});

test('uses the matched transition when a node has default plus another transition', async () => {
  const { resolveRoutingDecision } = await import('../lib/funnel/routing.ts');
  const decision = resolveRoutingDecision({
    node: {
      id: 'n1',
      transitions: [
        { condition: 'default', target: 'n6' },
        { condition: 'objection_raised', target: 'n9' },
      ],
      fallback_condition: 'no_match',
      fallback_target: 'n1',
      max_retries_before_handoff: 1,
    },
    classifierResult: { condition: 'objection_raised' },
    noMatchRetryCount: 0,
  });

  assert.equal(decision.shouldSkipClassifier, false);
  assert.equal(decision.targetNodeId, 'n9');
  assert.equal(decision.condition, 'objection_raised');
  assert.equal(decision.shouldHandoff, false);
});

test('escalates to handoff on the third no-match attempt', async () => {
  const { deriveRetryState } = await import('../lib/funnel/routing.ts');
  const state = deriveRetryState({
    previousRetryCount: 2,
    decision: {
      shouldSkipClassifier: false,
      condition: 'no_match',
      targetNodeId: null,
      shouldHandoff: false,
    },
    threshold: 3,
  });

  assert.equal(state.retryCount, 3);
  assert.equal(state.shouldHandoff, true);
});

test('resets the retry counter after a successful transition', async () => {
  const { deriveRetryState } = await import('../lib/funnel/routing.ts');
  const state = deriveRetryState({
    previousRetryCount: 2,
    decision: {
      shouldSkipClassifier: false,
      condition: 'answers_received',
      targetNodeId: 'n2',
      shouldHandoff: false,
    },
    threshold: 3,
  });

  assert.equal(state.retryCount, 0);
  assert.equal(state.shouldHandoff, false);
});

test('persists retry state through rpc and uses the same rpc response for duplicate handoff guard', async () => {
  const rpcCalls: Array<Record<string, unknown>> = [];
  const rpcResponses = [
    {
      data: [{
        id: 'row-1',
        lead_id: 'lead-1',
        agent_id: 'agent-1',
        current_node_id: 'n1',
        status: 'active',
        retry_count: 1,
        was_already_paused: false,
        last_transition_at: null,
        created_at: null,
        updated_at: null,
      }],
      error: null,
    },
    {
      data: [{
        id: 'row-2',
        lead_id: 'lead-1',
        agent_id: 'agent-1',
        current_node_id: 'n1',
        status: 'paused',
        retry_count: 2,
        was_already_paused: true,
        last_transition_at: null,
        created_at: null,
        updated_at: null,
      }],
      error: null,
    },
    {
      data: [{
        id: 'row-3',
        lead_id: 'lead-1',
        agent_id: 'agent-1',
        current_node_id: 'n1',
        status: 'paused',
        retry_count: 2,
        was_already_paused: true,
        last_transition_at: null,
        created_at: null,
        updated_at: null,
      }],
      error: null,
    },
  ];

  const admin = {
    rpc: async (_name: string, params: Record<string, unknown>) => {
      rpcCalls.push(params);
      return rpcResponses.shift() ?? { data: null, error: null };
    },
    from: (_table: string) => ({
      insert: async () => ({ data: null, error: null }),
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { org_id: null, attributes: {} }, error: null }),
        }),
      }),
    }),
  };

  const flow = {
    entryNodeId: 'n1',
    nodes: [{
      id: 'n1',
      title: 'start',
      transitions: [{ condition: 'answer_received', target: 'n2' }],
      fallback_condition: 'no_match',
      fallback_target: 'n2',
      max_retries_before_handoff: 1,
    }],
  };

  const { applyFunnelRouting } = await import('../lib/funnel/routing.ts');

  const firstResult = await applyFunnelRouting({
    admin,
    agentId: 'agent-1',
    leadId: 'lead-1',
    conversationId: 'conversation-1',
    flow: flow as any,
    currentNodeId: 'n1',
    userMessage: 'hello',
    assistantReply: 'hello',
    classifier: async () => ({ condition: 'no_match' }),
  });

  const secondResult = await applyFunnelRouting({
    admin,
    agentId: 'agent-1',
    leadId: 'lead-1',
    conversationId: 'conversation-1',
    flow: flow as any,
    currentNodeId: 'n1',
    userMessage: 'hello',
    assistantReply: 'hello',
    classifier: async () => ({ condition: 'no_match' }),
  });

  assert.equal(rpcCalls.length, 3);
  assert.equal(rpcCalls[0].p_status, 'active');
  assert.equal(rpcCalls[0].p_is_no_match, false);
  assert.equal(rpcCalls.some((call) => call.p_status === 'paused'), true);
  assert.equal(firstResult.shouldHandoff, true);
  assert.equal(secondResult.shouldHandoff, false);
  assert.equal(secondResult.duplicateHandoffSkipped, true);
});

test('routing prompt includes previous agent answer and explicit name-answer instruction', async () => {
  const { buildRoutingPrompt } = await import('../lib/funnel/routing.ts');

  const prompt = buildRoutingPrompt(
    {
      id: 'greeting',
      title: 'Greeting',
      content: 'Привет! Как вас зовут?',
      transitions: [{ condition: 'answers_received', target: 'discovery' }],
    } as any,
    'Кыдырали',
    'Привет! Как вас зовут?',
  );

  assert.match(prompt, /Последний ответ агента: Привет! Как вас зовут\?/);
  assert.match(prompt, /Если текущий шаг содержит вопрос об имени, классе, предмете, ЕНТ, контакте, цене или желании учиться/);
  assert.match(prompt, /Текст узла: Привет! Как вас зовут\?/);
});

test('resolves post-routing reply so handoff notice is sent while the original reply is suppressed', async () => {
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

test('orchestrator routing handoff path executes redirectToOperator once across the full path', async () => {
  const executeToolCalls: Array<{ call: Record<string, unknown>; context: Record<string, unknown> }> = [];

  const { applyRoutingAndFinalizeReply } = await import('../lib/server/ai/orchestrator.ts');

  const admin = {
    rpc: async (_name: string, params: Record<string, unknown>) => ({
      data: [{
        id: 'row-1',
        lead_id: 'lead-1',
        agent_id: 'agent-1',
        current_node_id: 'n1',
        status: 'active',
        retry_count: 1,
        was_already_paused: false,
        last_transition_at: null,
        created_at: null,
        updated_at: null,
      }],
      error: null,
    }),
    from: (_table: string) => ({
      insert: async () => ({ data: null, error: null }),
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { org_id: 'org-1', attributes: {} }, error: null }),
        }),
      }),
    }),
  };

  const flow = {
    entryNodeId: 'n1',
    nodes: [{
      id: 'n1',
      title: 'start',
      transitions: [{ condition: 'answer_received', target: 'n2' }],
      fallback_condition: 'no_match',
      fallback_target: 'n2',
      max_retries_before_handoff: 1,
    }],
  };

  const result = await applyRoutingAndFinalizeReply({
    admin,
    agentId: 'agent-1',
    leadId: 'lead-1',
    conversationId: 'conversation-1',
    flow: flow as any,
    currentFunnelStep: 'n1',
    userMessage: 'hello',
    finalAnswer: 'Оригинальный ответ',
    handoffConfig: { client_message: 'Подключаю сотрудника' } as any,
    executeToolImpl: async (call, context) => {
      executeToolCalls.push({ call: call as Record<string, unknown>, context: context as Record<string, unknown> });
      return { name: call.name, result: { success: true }, error: null };
    },
  });

  assert.equal(result.handoffTriggered, true);
  assert.equal(result.finalAnswer, 'Подключаю сотрудника');
  assert.equal(result.shouldAppendMessage, true);
  assert.equal(executeToolCalls.length, 1);
  assert.equal(executeToolCalls[0].call.name, 'redirectToOperator');
});

test('first handoff reports was_already_paused=false and invokes redirectToOperator', async () => {
  const executeToolCalls: Array<{ call: Record<string, unknown>; context: Record<string, unknown> }> = [];

  const { applyFunnelRouting } = await import('../lib/funnel/routing.ts');

  const admin = {
    rpc: async (_name: string, params: Record<string, unknown>) => ({
      data: [{
        id: 'row-1',
        lead_id: 'lead-1',
        agent_id: 'agent-1',
        current_node_id: 'n1',
        status: 'active',
        retry_count: 1,
        was_already_paused: false,
        last_transition_at: null,
        created_at: null,
        updated_at: null,
      }],
      error: null,
    }),
    from: (_table: string) => ({
      insert: async () => ({ data: null, error: null }),
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { org_id: 'org-1', attributes: {} }, error: null }),
        }),
      }),
    }),
  };

  const flow = {
    entryNodeId: 'n1',
    nodes: [{
      id: 'n1',
      title: 'start',
      transitions: [{ condition: 'answer_received', target: 'n2' }],
      fallback_condition: 'no_match',
      fallback_target: 'n2',
      max_retries_before_handoff: 1,
    }],
  };

  const result = await applyFunnelRouting({
    admin,
    agentId: 'agent-1',
    leadId: 'lead-1',
    conversationId: 'conversation-1',
    flow: flow as any,
    currentNodeId: 'n1',
    userMessage: 'hello',
    assistantReply: 'hello',
    classifier: async () => ({ condition: 'no_match' }),
    executeToolImpl: async (call, context) => {
      executeToolCalls.push({ call: call as Record<string, unknown>, context: context as Record<string, unknown> });
      return { name: call.name, result: { success: true }, error: null };
    },
  });

  assert.equal(result.shouldHandoff, true);
  assert.equal(result.handoffExecuted, true);
  assert.equal(executeToolCalls.length, 1);
  assert.equal(executeToolCalls[0].call.name, 'redirectToOperator');
  assert.equal(executeToolCalls[0].context.orgId, 'org-1');
});
