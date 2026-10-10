import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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

test('runAgentTurn persists a regular assistant reply without handoff', async (t) => {
  if (!process.env.GEMINI_API_KEY) {
    t.skip('Skipping orchestrator persistence test because GEMINI_API_KEY is not configured');
    return;
  }

  const { createAdminClient } = await import('../lib/supabase/admin.ts');
  const admin = createAdminClient();
  const orgId = randomUUID();
  const agentId = randomUUID();
  const leadId = randomUUID();

  const orgResult = await admin.from('organizations').insert({ id: orgId, name: `persist-${Date.now()}` }).select('id').single();
  assert.ifError(orgResult.error);

  const agentResult = await admin.from('agents').insert({
    id: agentId,
    org_id: orgId,
    name: 'persist-router-agent',
    model: 'gemini-2.5-flash',
    dialogue_flow: null,
    general_capabilities: {},
    system_prompt_compiled: 'Ты дружелюбный агент.',
    is_active: true,
  }).select('id').single();
  assert.ifError(agentResult.error);

  const leadResult = await admin.from('leads').insert({
    id: leadId,
    org_id: orgId,
    external_id: `persist-${Date.now()}`,
    name: 'Persist Lead',
    ai_enabled: true,
  }).select('id').single();
  assert.ifError(leadResult.error);

  const conversationResult = await admin.from('conversations').insert({
    lead_id: leadId,
    agent_id: agentId,
  }).select('id').single();
  assert.ifError(conversationResult.error);

  const conversationId = conversationResult.data?.id;
  assert.ok(conversationId, 'Conversation should be created');

  try {
    const { runAgentTurn } = await import('../lib/server/ai/orchestrator.ts');
    const result = await runAgentTurn(agentId, 'Ты агент', 'Привет! Как дела?', [], leadId, conversationId);

    assert.ok(result.answer.trim().length > 0, 'Agent should return a regular non-empty answer');

    const { data: messages } = await admin
      .from('messages')
      .select('sender, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    assert.ok(Array.isArray(messages) && messages.length >= 2, 'Conversation should contain user and assistant messages');
    const lastMessage = messages[messages.length - 1];
    assert.equal(lastMessage?.sender, 'ai', 'Last message in the ordinary case should be the AI reply');
    assert.ok(typeof lastMessage?.content === 'string' && lastMessage.content.trim().length > 0, 'AI message content should not be empty');
  } finally {
    await admin.from('messages').delete().eq('conversation_id', conversationId);
    await admin.from('conversations').delete().eq('id', conversationId);
    await admin.from('leads').delete().eq('id', leadId);
    await admin.from('agents').delete().eq('id', agentId);
    await admin.from('organizations').delete().eq('id', orgId);
  }
});
