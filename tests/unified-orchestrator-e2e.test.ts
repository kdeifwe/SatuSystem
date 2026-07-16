import { strict as assert } from 'assert';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

dotenv.config({ path: '.env.local' });

async function createAdmin() {
  const { createAdminClient } = await import('../lib/supabase/admin.ts');
  return createAdminClient();
}

type ChatMessage = {
  role: 'user' | 'model';
  text: string;
};

const TEST_AGENT_ID = '1469465d-418d-44ac-9751-a304666e6dc4';

async function createRealLeadContext(agentId: string) {
  const admin = await createAdmin();
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

async function cleanupRealLeadContext(ctx: { admin: any; leadId: string; conversationId: string }) {
  await ctx.admin.from('ai_call_logs').delete().eq('conversation_id', ctx.conversationId);
  await ctx.admin.from('lead_notes').delete().eq('lead_id', ctx.leadId);
  await ctx.admin.from('messages').delete().eq('conversation_id', ctx.conversationId);
  await ctx.admin.from('conversations').delete().eq('id', ctx.conversationId);
  await ctx.admin.from('leads').delete().eq('id', ctx.leadId);
}

async function setConversationNode(admin: any, conversationId: string, nodeId: string) {
  const { error } = await admin.from('conversations').update({ current_funnel_step: nodeId }).eq('id', conversationId);
  assert.ifError(error);
}

async function createWhatsAppWebhookTestContext() {
  const admin = await createAdmin();
  const orgName = `e2e-whatsapp-${Date.now()}`;
  const { data: org, error: orgError } = await admin.from('organizations').insert({ name: orgName }).select('id').single();
  assert.ifError(orgError);
  assert.ok(org?.id, 'Org should be created for WhatsApp webhook test');

  const phoneNumber = `+7${Math.floor(9000000000 + Math.random() * 900000000)}`;
  const { data: channel, error: channelError } = await admin.from('channels').insert({
    org_id: org.id,
    type: 'whatsapp',
    credentials: { app_secret: 'test', phone_number_id: `whatsapp-phone-id-${Date.now()}-${randomUUID()}`, access_token: 'whatsapp-access-token' },
    is_active: true,
  }).select('id').single();
  assert.ifError(channelError);
  assert.ok(channel?.id, 'WhatsApp channel should be created');

  const { data: agent, error: agentError } = await admin.from('agents').insert({
    org_id: org.id,
    name: 'e2e-whatsapp-agent',
    dialogue_flow: null,
    general_capabilities: {},
    model: 'gemini-3.5-flash',
    system_prompt_compiled: 'Ты тестовый WhatsApp-агент. Отвечай по-русски.',
    is_active: true,
  }).select('id').single();
  assert.ifError(agentError);
  assert.ok(agent?.id, 'Agent should be created for WhatsApp webhook test');

  const { data: lead, error: leadError } = await admin.from('leads').insert({
    org_id: org.id,
    channel_id: channel.id,
    external_id: phoneNumber,
    name: 'e2e Whatsapp Lead',
    status: 'new',
    ai_enabled: true,
  }).select('id').single();
  assert.ifError(leadError);
  assert.ok(lead?.id, 'Lead should be created for WhatsApp webhook test');

  const { data: conversation, error: conversationError } = await admin.from('conversations').insert({
    lead_id: lead.id,
    agent_id: agent.id,
  }).select('id').single();
  assert.ifError(conversationError);
  assert.ok(conversation?.id, 'Conversation should be created for WhatsApp webhook test');

  await admin.from('messages').insert([
    { conversation_id: conversation.id, sender: 'user', content: 'Привет, я хочу узнать об условиях.' },
    { conversation_id: conversation.id, sender: 'ai', content: 'Привет! Расскажи, пожалуйста, что именно тебя интересует.' },
  ]);

  return {
    admin,
    orgId: org.id,
    channelId: channel.id,
    agentId: agent.id,
    leadId: lead.id,
    conversationId: conversation.id,
    phoneNumber,
  };
}

async function cleanupWhatsAppWebhookTestContext(ctx: {
  admin: any; orgId: string; channelId: string; agentId: string; leadId: string; conversationId: string;
}) {
  await ctx.admin.from('ai_call_logs').delete().eq('conversation_id', ctx.conversationId);
  await ctx.admin.from('messages').delete().eq('conversation_id', ctx.conversationId);
  await ctx.admin.from('conversations').delete().eq('id', ctx.conversationId);
  await ctx.admin.from('leads').delete().eq('id', ctx.leadId);
  await ctx.admin.from('agents').delete().eq('id', ctx.agentId);
  await ctx.admin.from('channels').delete().eq('id', ctx.channelId);
  await ctx.admin.from('organizations').delete().eq('id', ctx.orgId);
}

// ============ TEST SUITE: Unified Orchestrator E2E ============

test('Unified Orchestrator E2E Tests', async (t) => {
  // ============ TEST 1: Script Message Path (n1_aigerim - no Gemini) ============
  await t.test('Test 1: Script-node (n1 Aigerim) sends script_parts WITHOUT Gemini call', async () => {
    const history: ChatMessage[] = [];
    const userMessage = 'Привет';

    console.log('[TEST 1] Running script-node test (n1_aigerim)...');
    const { admin, leadId, conversationId } = await createRealLeadContext(TEST_AGENT_ID);
    try {
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
    } finally {
      await cleanupRealLeadContext({ admin, leadId, conversationId });
    }
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
    try {
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
    } finally {
      await cleanupRealLeadContext({ admin, leadId, conversationId });
    }
  });

  await t.test('Test 2.1: WhatsApp webhook real lead context generates ai_call_logs on the same conversation', async () => {
    if (!process.env.GEMINI_API_KEY) {
      t.skip('Skipping WhatsApp webhook integration test because GEMINI_API_KEY is not configured');
      return;
    }

    process.env.SKIP_WEBHOOK_SIGNATURE_CHECK = 'true';
    const ctx = await createWhatsAppWebhookTestContext();
    const { admin, orgId, conversationId, phoneNumber } = ctx;
    try {
      const { processIncomingWhatsAppMessage } = await import('../lib/server/whatsapp-webhook.js');

      const webhookPayload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: phoneNumber,
                      id: `wa-test-${Date.now()}`,
                      text: { body: 'А скидки есть?' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      await processIncomingWhatsAppMessage(webhookPayload as any);

      const { data: messages } = await admin
        .from('messages')
        .select('sender,content,external_message_id')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      assert.ok(Array.isArray(messages) && messages.length >= 4, 'Conversation should contain previous history plus the new user and AI reply');
      assert.equal(messages?.[messages.length - 1]?.sender, 'ai', 'Latest message should be the AI reply in the same conversation');

      const { data: logs } = await admin
        .from('ai_call_logs')
        .select('request')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      const agentResponses = (logs ?? []).filter((row) => row.request?.type === 'agent_response');
      assert.ok(agentResponses.length > 0, 'Should create ai_call_logs entry for the real WhatsApp conversation');
      assert.ok(agentResponses.some((row) => (row.request?.messages_in_context ?? 0) > 0), 'messages_in_context must be > 0 for a non-first WhatsApp turn');

      const { data: sandboxLeads } = await admin
        .from('leads')
        .select('id,external_id')
        .ilike('external_id', 'sandbox:%')
        .eq('org_id', orgId);

      assert.equal(sandboxLeads?.length ?? 0, 0, 'Handling real WhatsApp webhook should not create a sandbox lead in the same org');

      console.log('[TEST 2.1] ✓ WhatsApp webhook real lead context preserved, ai_call_logs created, and no sandbox lead was created.');
    } finally {
      await cleanupWhatsAppWebhookTestContext(ctx);
    }
  });

  // ============ TEST 3: Routing B (funnel step transition) ============
  await t.test('Test 3: Routing B - funnel step transition ("английский и математика" → answers_received)', async () => {
    const history: ChatMessage[] = [];
    const userMessage = 'Я выбираю английский и математику, мне нужна специальность в IT';

    console.log('[TEST 3] Running routing test...');
    const { admin, leadId, conversationId } = await createRealLeadContext(TEST_AGENT_ID);
    try {
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
    } finally {
      await cleanupRealLeadContext({ admin, leadId, conversationId });
    }
  });

  // ============ TEST 4: RAG - Knowledge Base Search ============
  await t.test('Test 4: RAG verification - knowledge base search works in unified orchestrator', async () => {
    const history: ChatMessage[] = [];
    const userMessage = 'What is our company policy on remote work?';

    console.log('[TEST 4] Running RAG test...');
    const { admin, leadId, conversationId } = await createRealLeadContext(TEST_AGENT_ID);
    try {
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
    } finally {
      await cleanupRealLeadContext({ admin, leadId, conversationId });
    }
  });

  // ============ TEST 5: Handoff - redirectToOperator Tool ============
  await t.test('Test 5: Handoff functionality - redirectToOperator still works', async () => {
    const history: ChatMessage[] = [];
    const userMessage = 'I need to speak to a human operator immediately';

    console.log('[TEST 5] Running handoff test...');
    const { admin, leadId, conversationId } = await createRealLeadContext(TEST_AGENT_ID);
    try {
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
    } finally {
      await cleanupRealLeadContext({ admin, leadId, conversationId });
    }
  });
});

console.log('\n=== Unified Orchestrator E2E Test Suite ===');
console.log('This test verifies that the unified orchestrator.ts works correctly:');
console.log('- Script/dynamic message split (Call A)');
console.log('- Funnel routing (Call B)');
console.log('- RAG knowledge base search');
console.log('- External lead support for webhooks');
console.log('- Handoff functionality\n');
