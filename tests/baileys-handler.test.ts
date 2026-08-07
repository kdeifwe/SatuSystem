import test from 'node:test';
import assert from 'node:assert/strict';
import { handleIncomingMessageWithDependencies } from '../lib/channels/baileys-handler';

test('Baileys handleIncomingMessage uses runAgentTurnWithLead and includes conversation history', async () => {
  let runAgentTurnWithLeadArgs: any = null;
  const runAgentTurnWithLead = async (
    agentId: string,
    systemPrompt: string,
    userMessage: string,
    history: Array<{ role: string; text: string }>,
    leadId: string,
    currentUserMessageId: string | null
  ) => {
    runAgentTurnWithLeadArgs = { agentId, systemPrompt, userMessage, history, leadId, currentUserMessageId };
    return { answer: 'Привет, я помню прошлую переписку.' };
  };

  const runAgentTurn = async () => {
    throw new Error('runAgentTurn should not be called for Baileys incoming messages');
  };

  const sendCalls: Array<{ jid: string; content: any }> = [];
  const sock = {
    sendMessage: async (jid: string, content: any) => {
      sendCalls.push({ jid, content });
    },
  };

  const adminClientMock = () => {
    return {
      from(table: string) {
        const query = { table, selectString: '', filters: {} as Record<string, any>, order: null as any, limitNumber: null as number | null, insertData: null as any, updateData: null as any };
        const builder: any = {
          select(selectString: string) {
            query.selectString = selectString;
            return builder;
          },
          eq(key: string, value: any) {
            query.filters[key] = value;
            return builder;
          },
          order(field: string, opts: any) {
            query.order = { field, opts };
            return builder;
          },
          limit(n: number) {
            query.limitNumber = n;
            return builder;
          },
          insert(data: any) {
            query.insertData = data;
            return builder;
          },
          update(data: any) {
            query.updateData = data;
            return builder;
          },
          maybeSingle() {
            return Promise.resolve(resolveQuery(query));
          },
          single() {
            return Promise.resolve(resolveQuery(query));
          },
          then(resolve: any) {
            resolve(resolveQuery(query));
          },
        };
        return builder;
      },
    };

    function resolveQuery(query: any) {
      if (query.table === 'channels' && query.updateData) {
        return { data: null, error: null };
      }

      if (query.table === 'agents' && query.filters.id === 'agent-test') {
        if (query.selectString === 'org_id') {
          return { data: { org_id: 'org-test' }, error: null };
        }
        return { data: { id: 'agent-test', name: 'Agent', system_prompt_compiled: 'Ты агент.' }, error: null };
      }

      if (query.table === 'channels' && query.filters.org_id === 'org-test') {
        return { data: { id: 'channel-test', org_id: 'org-test' }, error: null };
      }

      if (query.table === 'messages' && query.selectString === 'id' && query.filters.external_message_id === 'wa_msg-1') {
        return { data: null, error: null };
      }

      if (query.table === 'leads' && query.filters.external_id === '123@s.whatsapp.net') {
        return { data: { id: 'lead-test', ai_enabled: true }, error: null };
      }

      if (query.table === 'conversations' && query.filters.lead_id === 'lead-test') {
        return { data: { id: 'conversation-test' }, error: null };
      }

      if (query.table === 'messages' && query.insertData?.sender === 'user') {
        return { data: { id: 'message-test' }, error: null };
      }

      if (query.table === 'messages' && query.selectString === 'sender, content') {
        return { data: [
          { sender: 'user', content: 'Привет' },
          { sender: 'ai', content: 'Здравствуйте' },
        ], error: null };
      }

      if (query.table === 'agents' && query.filters.id === 'agent-test') {
        return { data: { name: 'Agent', system_prompt_compiled: 'Привет, я агент.', general_capabilities: {} }, error: null };
      }

      return { data: null, error: null };
    }
  };

  const message = {
    key: {
      fromMe: false,
      remoteJid: '123@s.whatsapp.net',
      id: 'msg-1',
    },
    message: {
      conversation: 'hello',
    },
    pushName: 'Test User',
  };

  await handleIncomingMessageWithDependencies('agent-test', sock as any, message as any, {
    createAdminClient: adminClientMock,
    ensureWhatsAppChannel: async () => ({ id: 'channel-test', org_id: 'org-test' }),
    runAgentTurnWithLead,
    logger: { error: () => undefined },
  });

  assert.ok(runAgentTurnWithLeadArgs, 'runAgentTurnWithLead should be called');
  assert.equal(runAgentTurnWithLeadArgs.agentId, 'agent-test');
  assert.equal(runAgentTurnWithLeadArgs.leadId, 'lead-test');
  assert.equal(runAgentTurnWithLeadArgs.userMessage, 'hello');
  assert.ok(Array.isArray(runAgentTurnWithLeadArgs.history), 'history should be an array');
  assert.ok(runAgentTurnWithLeadArgs.history.length > 0, 'history should not be empty');
  assert.equal(runAgentTurnWithLeadArgs.history[0].role, 'model');
  assert.equal(runAgentTurnWithLeadArgs.history[0].text, 'Здравствуйте');
  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].content.text, 'Привет, я помню прошлую переписку.');
});
