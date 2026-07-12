import { strict as assert } from 'assert';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

dotenv.config({ path: '.env.local' });

type ChatMessage = {
  role: 'user' | 'model';
  text: string;
};

const TEST_AGENT_ID = '1469465d-418d-44ac-9751-a304666e6dc4';

async function createRealLeadContext(agentId: string) {
  const { createAdminClient } = await import('../lib/supabase/admin.ts');
  const admin = createAdminClient();
  const { data: agent, error: agentError } = await admin
    .from('agents')
    .select('org_id')
    .eq('id', agentId)
    .maybeSingle();

  assert.ifError(agentError);
  assert.ok(agent?.org_id, 'Agent should have org_id for lead context');

  const leadId = randomUUID();
  const { data: lead, error: leadError } = await admin
    .from('leads')
    .insert({
      id: leadId,
      org_id: agent!.org_id,
      external_id: `e2e-${Date.now()}-${randomUUID()}`,
      name: `e2e-${Date.now()}`,
      ai_enabled: true,
    })
    .select('id')
    .single();

  assert.ifError(leadError);
  assert.ok(lead?.id, 'Lead should be created for real-context test');

  const { data: conversation, error: conversationError } = await admin
    .from('conversations')
    .insert({
      lead_id: lead.id,
      agent_id: agentId,
    })
    .select('id')
    .single();

  assert.ifError(conversationError);
  assert.ok(conversation?.id, 'Conversation should be created for real-context test');

  return { admin, leadId: lead.id, conversationId: conversation!.id };
}

async function setConversationNode(admin: any, conversationId: string, nodeId: string) {
  const { error } = await admin.from('conversations').update({ current_funnel_step: nodeId }).eq('id', conversationId);
  assert.ifError(error);
}

// ============ TEST SUITE: Unified Orchestrator E2E ============

test('Unified Orchestrator E2E Tests', async (t) => {
  // ============ TEST 1: Script Message Path (n1_aigerim - no Gemini) ============
  await t.test('Test 1: Script-node (n1 Aigerim) sends script_parts WITHOUT Gemini call', async () => {
    const history: ChatMessage[] = [];
    const userMessage = 'Привет';

    console.log('[TEST 1] Running script-node test (n1_aigerim)...');
    const { admin, leadId, conversationId } = await createRealLeadContext(TEST_AGENT_ID);
    const { runAgentTurn } = await import('../lib/server/ai/orchestrator.js');
    const result = await runAgentTurn(TEST_AGENT_ID, 'Ты агент', userMessage, history, leadId);

    console.log('[TEST 1] Result:', {
      answer_length: result.answer?.length,
      tokens_input: result.tokensInput,
      tokens_output: result.tokensOutput,
      message_parts_count: result.messageParts?.length,
      answer_preview: result.answer?.slice(0, 120),
    });

    assert.ok(result.answer?.trim(), 'Script path should produce a non-empty answer');
    assert.ok(Array.isArray(result.messageParts) && result.messageParts.length > 0, 'Script path should return pre-written message parts');
    assert.equal(result.tokensInput ?? 0, 0, 'Script path should not consume Gemini input tokens');
    assert.equal(result.tokensOutput ?? 0, 0, 'Script path should not consume Gemini output tokens');
    assert.match(result.answer, /Сәлеметсіз бе|Айгерим|қай сыныпта/, 'Script answer should contain the script text from node n1');

    const { data: conversationState } = await admin
      .from('conversations')
      .select('current_funnel_step')
      .eq('id', conversationId)
      .maybeSingle();

    assert.equal(conversationState?.current_funnel_step, 'n1', 'Script path should keep the conversation on the entry node n1');
    console.log(`[TEST 1] ✓ Script path confirmed. tokensIn=${result.tokensInput}, tokensOut=${result.tokensOutput}, node=${conversationState?.current_funnel_step}`);
  });

  // ============ TEST 2: Dynamic Message Path (with Gemini) ============
  await t.test('Test 2: Dynamic-node calls Gemini normally', async () => {
    const history: ChatMessage[] = [
      { role: 'user', text: 'Привет' },
      { role: 'model', text: 'Привет! Я ассистент.' },
    ];
    const userMessage = 'Как дела?';

    console.log('[TEST 2] Running dynamic-node test...');
    const { admin, leadId, conversationId } = await createRealLeadContext(TEST_AGENT_ID);
    await setConversationNode(admin, conversationId, 'n2');
    const { runAgentTurn } = await import('../lib/server/ai/orchestrator.js');
    const result = await runAgentTurn(TEST_AGENT_ID, 'Ты agencyassistant', userMessage, history, leadId);

    console.log('[TEST 2] Result:', {
      answer_length: result.answer?.length,
      tokens_input: result.tokensInput,
      tokens_output: result.tokensOutput,
      split_messages: result.splitMessages,
      answer_preview: result.answer?.slice(0, 120),
    });

    assert.ok(result.answer?.trim(), 'Dynamic path should produce an answer from Gemini');
    assert.ok((result.tokensInput ?? 0) > 0, 'Dynamic path should have Gemini input tokens');
    assert.ok((result.tokensOutput ?? 0) > 0, 'Dynamic path should have Gemini output tokens');

    console.log(`[TEST 2] ✓ Gemini called successfully. Tokens: input=${result.tokensInput}, output=${result.tokensOutput}`);
  });

  // ============ TEST 3: Routing B (funnel step transition) ============
  await t.test('Test 3: Routing B - funnel step transition ("английский и математика" → answers_received)', async () => {
    const history: ChatMessage[] = [];
    const userMessage = 'Я выбираю английский и математику, мне нужна специальность в IT';

    console.log('[TEST 3] Running routing test...');
    const { admin, leadId, conversationId } = await createRealLeadContext(TEST_AGENT_ID);
    await setConversationNode(admin, conversationId, 'n2');
    const { runAgentTurn } = await import('../lib/server/ai/orchestrator.js');
    const result = await runAgentTurn(TEST_AGENT_ID, 'Determine user intent', userMessage, history, leadId);

    console.log('[TEST 3] Result:', {
      answer_length: result.answer?.length,
      answer_preview: result.answer?.slice(0, 140),
    });

    assert.ok(result.answer?.trim(), 'Routing flow should produce an answer');

    const { data: conversationState } = await admin
      .from('conversations')
      .select('current_funnel_step')
      .eq('id', conversationId)
      .maybeSingle();

    assert.equal(conversationState?.current_funnel_step, 'n3', 'Routing should advance the conversation from n2 to n3 when classifier returns answers_received');
    console.log(`[TEST 3] ✓ Routing executed successfully. Transitioned n2 → n3 via answers_received condition. currentStep=${conversationState?.current_funnel_step}`);
  });

  // ============ TEST 4: RAG - Knowledge Base Search ============
  await t.test('Test 4: RAG verification - knowledge base search works in unified orchestrator', async () => {
    const history: ChatMessage[] = [];
    const userMessage = 'What is our company policy on remote work?';

    console.log('[TEST 4] Running RAG test...');
    const { admin, leadId, conversationId } = await createRealLeadContext(TEST_AGENT_ID);
    await setConversationNode(admin, conversationId, 'n2');
    const { runAgentTurn } = await import('../lib/server/ai/orchestrator.js');
    const result = await runAgentTurn(TEST_AGENT_ID, 'Answer based on knowledge base', userMessage, history, leadId);

    console.log('[TEST 4] Result:', {
      answer_length: result.answer?.length,
      used_chunks_count: result.usedChunks?.length,
      retrieval_debug_exists: !!result.retrievalDebug,
      primary_chunks_count: result.retrievalDebug?.primaryChunks?.length ?? 0,
      answer_preview: result.answer?.slice(0, 140),
    });

    assert.ok(result.answer?.trim(), 'RAG path should produce an answer');
    assert.ok(!!result.retrievalDebug, 'RAG path should populate retrieval debug data');
    assert.ok(Array.isArray(result.usedChunks), 'RAG path should return usedChunks');
    console.log(`[TEST 4] ✓ RAG executed. Used chunks: ${result.usedChunks?.length ?? 0}`);
  });

  // ============ TEST 5: Handoff - redirectToOperator Tool ============
  await t.test('Test 5: Handoff functionality - redirectToOperator still works', async () => {
    const history: ChatMessage[] = [];
    const userMessage = 'I need to speak to a human operator immediately';

    console.log('[TEST 5] Running handoff test...');
    const { admin, leadId, conversationId } = await createRealLeadContext(TEST_AGENT_ID);
    await setConversationNode(admin, conversationId, 'n2');
    const { runAgentTurn } = await import('../lib/server/ai/orchestrator.js');
    const result = await runAgentTurn(TEST_AGENT_ID, 'Determine if handoff needed', userMessage, history, leadId);

    console.log('[TEST 5] Result:', {
      answer_length: result.answer?.length,
      handoff_message_exists: !!result.handoffMessage,
      answer_preview: result.answer?.slice(0, 140),
    });

    assert.ok(result.answer?.trim(), 'Handoff flow should produce an answer');
    assert.ok(Boolean(result.handoffMessage) || /Подключаю сотрудника|оператор/i.test(result.answer ?? ''), 'Handoff should surface a handoff response');

    const { data: leadRow } = await admin.from('leads').select('ai_enabled').eq('id', leadId).maybeSingle();
    const { data: notes } = await admin.from('lead_notes').select('id').eq('lead_id', leadId).limit(10);

    assert.equal(leadRow?.ai_enabled, false, 'Lead ai_enabled should be disabled after handoff');
    assert.ok((notes?.length ?? 0) > 0, 'Handoff should create a lead note');

    console.log(`[TEST 5] ✓ Handoff pathway tested. lead_ai_enabled=${leadRow?.ai_enabled}, notes=${notes?.length ?? 0}`);
  });
});

console.log('\n=== Unified Orchestrator E2E Test Suite ===');
console.log('This test verifies that the unified orchestrator.ts works correctly:');
console.log('- Script/dynamic message split (Call A)');
console.log('- Funnel routing (Call B)');
console.log('- RAG knowledge base search');
console.log('- External lead support for webhooks');
console.log('- Handoff functionality\n');
