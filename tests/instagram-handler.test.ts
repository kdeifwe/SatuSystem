import test from 'node:test';
import assert from 'node:assert/strict';
import { handleIncomingMessageWithDependencies } from '../lib/channels/instagram-handler';

test('Instagram handleIncomingMessage creates a lead and uses the agent turn flow', async () => {
  let runArgs: any = null;

  const adminClientMock = () => ({
    from(table: string) {
      const query: any = { table, filters: {}, selectString: '', insertData: null, order: null, limitNumber: null };
      const builder: any = {
        select(selectString: string) {
          query.selectString = selectString;
          return builder;
        },
        eq(key: string, value: unknown) {
          query.filters[key] = value;
          return builder;
        },
        update(data: unknown) {
          query.insertData = data;
          return builder;
        },
        order(field: string, opts: any) {
          query.order = { field, opts };
          return builder;
        },
        limit(n: number) {
          query.limitNumber = n;
          if (query.table === 'messages' && query.selectString === 'sender, content') {
            return Promise.resolve({ data: [{ sender: 'user', content: 'Привет' }, { sender: 'model', content: 'Здравствуйте' }], error: null });
          }
          return builder;
        },
        insert(data: unknown) {
          query.insertData = data;
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(resolveQuery(query));
        },
        single() {
          return Promise.resolve(resolveQuery(query));
        },
      };

      function resolveQuery(current: any) {
        if (current.table === 'channels' && current.filters.type === 'instagram') {
          return { data: { id: 'channel-instagram', org_id: 'org-test' }, error: null };
        }

        if (current.table === 'messages' && current.filters.external_message_id === 'ig_123') {
          return { data: null, error: null };
        }

        if (current.table === 'leads' && current.filters.external_id === 'thread_123') {
          return { data: { id: 'lead-instagram', ai_enabled: true }, error: null };
        }

        if (current.table === 'conversations' && current.filters.lead_id === 'lead-instagram') {
          return { data: { id: 'conv-instagram' }, error: null };
        }

        if (current.table === 'leads' && current.insertData && current.selectString === 'id, ai_enabled') {
          return { data: { id: 'lead-instagram', ai_enabled: true }, error: null };
        }

        if (current.table === 'conversations' && current.insertData && current.selectString === 'id') {
          return { data: { id: 'conv-instagram' }, error: null };
        }

        if (current.table === 'messages' && current.insertData?.sender === 'user') {
          return { data: { id: 'message-instagram' }, error: null };
        }

        if (current.table === 'messages' && current.selectString === 'sender, content') {
          return { data: [{ sender: 'user', content: 'Привет' }, { sender: 'model', content: 'Здравствуйте' }], error: null };
        }

        if (current.table === 'agents' && current.filters.id === 'agent-test') {
          return { data: { name: 'Agent', system_prompt_compiled: 'Ты агент.', general_capabilities: {} }, error: null };
        }

        return { data: null, error: null };
      }

      return builder;
    },
  });

  const sendCalls: Array<{ threadId: string; text: string }> = [];

  const igClient = {
    state: { cookieUserId: '999' },
    user: {
      getInfo: async () => ({ username: 'alice' }),
    },
  };

  await handleIncomingMessageWithDependencies(
    'agent-test',
    igClient as any,
    {
      message: {
        item_id: '123',
        thread_id: 'thread_123',
        user_id: '777',
        text: 'Привет',
        item_type: 'text',
      },
    },
    {
      createAdminClient: adminClientMock,
      ensureInstagramChannel: async () => ({ id: 'channel-instagram', org_id: 'org-test' }),
      runAgentTurnWithLead: (async (agentId: string, systemPrompt: string, userMessage: string, history: any[], leadId: string, currentUserMessageId?: string | null, _options?: any) => {
        runArgs = { agentId, systemPrompt, userMessage, history, leadId, currentUserMessageId };
        return { answer: 'Привет, я агент.' };
      }) as any,
      logger: { error: () => undefined },
      getSenderInfo: async () => ({ username: 'alice' }),
      sendText: async (agentId: string, threadId: string, text: string) => {
        sendCalls.push({ threadId, text });
      },
    }
  );

  assert.ok(runArgs, 'runAgentTurnWithLead should be called for Instagram');
  assert.equal(runArgs.leadId, 'lead-instagram');
  assert.equal(runArgs.userMessage, 'Привет');
  assert.equal(runArgs.history[0].role, 'model');
  assert.equal(runArgs.history[0].text, 'Здравствуйте');
  assert.equal(sendCalls[0].threadId, 'thread_123');
  assert.equal(sendCalls[0].text, 'Привет, я агент.');
});

test('Instagram ignores self messages and deduplicates repeated item_id', async () => {
  let runCount = 0;
  const adminClientMock = () => ({
    from(table: string) {
      const query: any = { table, filters: {}, selectString: '', insertData: null, order: null, limitNumber: null };
      const builder: any = {
        select(selectString: string) {
          query.selectString = selectString;
          return builder;
        },
        eq(key: string, value: unknown) {
          query.filters[key] = value;
          return builder;
        },
        update(data: unknown) {
          query.insertData = data;
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
        insert(data: unknown) {
          query.insertData = data;
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(resolveQuery(query));
        },
        single() {
          return Promise.resolve(resolveQuery(query));
        },
      };

      function resolveQuery(current: any) {
        if (current.table === 'channels' && current.filters.type === 'instagram') {
          return { data: { id: 'channel-instagram', org_id: 'org-test' }, error: null };
        }
        if (current.table === 'messages' && current.filters.external_message_id === 'ig_456') {
          return { data: { id: 'existing-message' }, error: null };
        }
        if (current.table === 'leads' && current.filters.external_id === 'thread_456') {
          return { data: { id: 'lead-dup', ai_enabled: true }, error: null };
        }
        if (current.table === 'conversations' && current.filters.lead_id === 'lead-dup') {
          return { data: { id: 'conv-dup' }, error: null };
        }
        if (current.table === 'messages' && current.insertData?.sender === 'user') {
          return { data: { id: 'message-instagram-dup' }, error: null };
        }
        if (current.table === 'agents' && current.filters.id === 'agent-test') {
          return { data: { name: 'Agent', system_prompt_compiled: 'Ты агент.', general_capabilities: {} }, error: null };
        }
        return { data: null, error: null };
      }

      return builder;
    },
  });

  const igClient = {
    state: { cookieUserId: '777' },
    user: { getInfo: async () => ({ username: 'alice' }) },
  };

  await handleIncomingMessageWithDependencies(
    'agent-test',
    igClient as any,
    {
      message: {
        item_id: '456',
        thread_id: 'thread_456',
        user_id: '777',
        text: 'Self message',
        item_type: 'text',
      },
    },
    {
      createAdminClient: adminClientMock,
      ensureInstagramChannel: async () => ({ id: 'channel-instagram', org_id: 'org-test' }),
      runAgentTurnWithLead: (async (..._args: any[]) => {
        runCount += 1;
        return { answer: 'Не отвечаю сам себе.' };
      }) as any,
      logger: { error: () => undefined },
      getSenderInfo: async () => ({ username: 'alice' }),
      sendText: async () => undefined,
    }
  );

  await handleIncomingMessageWithDependencies(
    'agent-test',
    igClient as any,
    {
      message: {
        item_id: '456',
        thread_id: 'thread_456',
        user_id: '999',
        text: 'Повторное сообщение',
        item_type: 'text',
      },
    },
    {
      createAdminClient: adminClientMock,
      ensureInstagramChannel: async () => ({ id: 'channel-instagram', org_id: 'org-test' }),
      runAgentTurnWithLead: (async (..._args: any[]) => {
        runCount += 1;
        return { answer: 'Дедуп сработал.' };
      }) as any,
      logger: { error: () => undefined },
      getSenderInfo: async () => ({ username: 'bob' }),
      sendText: async () => undefined,
    }
  );

  assert.equal(runCount, 0, 'Own message and duplicated item_id should be ignored');
});
