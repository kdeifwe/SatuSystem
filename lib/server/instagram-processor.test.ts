import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { verifyInstagramInboundSignature } from './instagram-inbound-signature';
import { withLeadProcessingLock } from './lead-processing-queue';
import {
  parseInstagramInboundPayload,
  processInstagramInbound,
  type InstagramInboundPayload,
  type InstagramProcessorDeps,
} from './instagram-processor';

type Row = Record<string, any>;

/** Минимальная in-memory имитация supabase-js для таблиц, которые трогает процессор. */
class FakeDb {
  tables: Record<string, Row[]> = { channels: [], leads: [], conversations: [], messages: [], agents: [] };
  private counter = 0;

  from(table: string) {
    return new Query(this, table);
  }

  nextId(table: string) {
    this.counter += 1;
    return `${table}-${this.counter}`;
  }

  tick() {
    this.counter += 1;
    return this.counter;
  }
}

class Query {
  private mode: 'select' | 'insert' | 'update' = 'select';
  private payload: Row = {};
  private filters: Array<[string, unknown]> = [];
  private orderBy: [string, boolean] | null = null;
  private max: number | null = null;

  constructor(private db: FakeDb, private table: string) {}

  select(_columns?: string) {
    return this;
  }
  insert(row: Row) {
    this.mode = 'insert';
    this.payload = row;
    return this;
  }
  update(patch: Row) {
    this.mode = 'update';
    this.payload = patch;
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = [column, options?.ascending !== false];
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    return this.run('maybe');
  }
  single() {
    return this.run('single');
  }
  then(resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown) {
    return this.run('many').then(resolve, reject);
  }

  private matching() {
    let rows = this.db.tables[this.table].filter((row) => this.filters.every(([column, value]) => row[column] === value));
    if (this.orderBy) {
      const [column, asc] = this.orderBy;
      rows = [...rows].sort((a, b) => (asc ? 1 : -1) * (a[column] - b[column]));
    }
    return this.max === null ? rows : rows.slice(0, this.max);
  }

  private async run(shape: 'maybe' | 'single' | 'many') {
    if (this.mode === 'insert') {
      const rows = this.db.tables[this.table];
      const dup =
        (this.table === 'messages' && this.payload.external_message_id && rows.some((r) => r.external_message_id === this.payload.external_message_id)) ||
        (this.table === 'leads' && rows.some((r) => r.channel_id === this.payload.channel_id && r.external_id === this.payload.external_id));
      if (dup) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      const row = { id: this.db.nextId(this.table), created_at: this.db.tick(), started_at: this.db.tick(), ...this.payload };
      rows.push(row);
      return { data: row, error: null };
    }
    if (this.mode === 'update') {
      for (const row of this.matching()) Object.assign(row, this.payload);
      return { data: null, error: null };
    }
    const rows = this.matching();
    if (shape === 'many') return { data: rows, error: null };
    if (shape === 'maybe') return { data: rows[0] ?? null, error: null };
    return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } };
  }
}

const PAYLOAD: InstagramInboundPayload = {
  channel_id: 'ch1',
  thread_id: '777',
  sender_id: '111',
  sender_username: 'client_ivan',
  sender_name: 'Иван',
  message_id: 'm1',
  text: 'Сколько стоит доставка?',
  timestamp: '2026-10-20T10:00:00Z',
};

function setup(overrides: Partial<InstagramProcessorDeps> = {}) {
  const db = new FakeDb();
  db.tables.channels.push({ id: 'ch1', org_id: 'org1', type: 'instagram', credentials: { agent_id: 'agent1', provider: 'userbot' } });
  db.tables.agents.push({ id: 'agent1', name: 'Алия', system_prompt_compiled: 'PROMPT', general_capabilities: { split_messages: false } });

  const sent: Array<[string, string, string]> = [];
  const aiCalls: Array<{ text: string; history: Array<{ role: string; text: string }>; leadId: string }> = [];
  const deps: InstagramProcessorDeps = {
    createAdminClient: () => db as any,
    runAgentTurnWithLead: async (_agentId, _prompt, text, history, leadId) => {
      aiCalls.push({ text, history, leadId });
      return { answer: 'Доставка 1500 тг.', messageParts: [{ text: 'Доставка 1500 тг.', delayMs: 0 }], splitMessages: false, typingSimulation: false, usedChunks: [] } as any;
    },
    sendText: async (agentId, threadId, text) => {
      sent.push([agentId, threadId, text]);
    },
    withLock: withLeadProcessingLock,
    sleep: async () => undefined,
    random: () => 0,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    ...overrides,
  };
  return { db, deps, sent, aiCalls };
}

test('processes a new message: creates lead, conversation, stores message and sends AI reply', async () => {
  const { db, deps, sent, aiCalls } = setup();
  const result = await processInstagramInbound(PAYLOAD, deps);

  assert.equal(result, 'processed');
  assert.equal(db.tables.leads.length, 1);
  assert.equal(db.tables.leads[0].external_id, '777');
  assert.equal(db.tables.leads[0].name, 'client_ivan');
  assert.deepEqual(db.tables.leads[0].attributes, { instagram_username: 'client_ivan' });
  assert.equal(db.tables.conversations.length, 1);
  assert.equal(db.tables.messages.length, 1);
  assert.equal(db.tables.messages[0].external_message_id, 'ig_m1');
  assert.equal(db.tables.messages[0].sender, 'user');
  assert.equal(aiCalls.length, 1);
  assert.deepEqual(aiCalls[0].history, []);
  assert.deepEqual(sent, [['agent1', '777', 'Доставка 1500 тг.']]);
});

test('duplicate delivery of the same message is ignored (unique index), AI is not called twice', async () => {
  const { db, deps, sent, aiCalls } = setup();
  assert.equal(await processInstagramInbound(PAYLOAD, deps), 'processed');
  assert.equal(await processInstagramInbound(PAYLOAD, deps), 'duplicate');
  assert.equal(db.tables.messages.length, 1);
  assert.equal(aiCalls.length, 1);
  assert.equal(sent.length, 1);
});

test('concurrent duplicate deliveries still produce a single reply', async () => {
  const { aiCalls, deps } = setup();
  const results = await Promise.all([processInstagramInbound(PAYLOAD, deps), processInstagramInbound(PAYLOAD, deps)]);
  assert.deepEqual([...results].sort(), ['duplicate', 'processed']);
  assert.equal(aiCalls.length, 1);
});

test('second message from the same thread reuses lead and passes history to AI', async () => {
  const { db, deps, aiCalls } = setup();
  await processInstagramInbound(PAYLOAD, deps);
  // ответ ИИ оркестратор сохраняет сам; имитируем это, чтобы проверить историю
  db.tables.messages.push({ id: 'ai-1', conversation_id: db.tables.conversations[0].id, sender: 'ai', content: 'Доставка 1500 тг.', created_at: db.tick() });

  const second = await processInstagramInbound({ ...PAYLOAD, message_id: 'm2', text: 'А по Алматы?' }, deps);
  assert.equal(second, 'processed');
  assert.equal(db.tables.leads.length, 1);
  assert.equal(db.tables.conversations.length, 1);
  assert.deepEqual(aiCalls[1].history, [
    { role: 'user', text: 'Сколько стоит доставка?' },
    { role: 'model', text: 'Доставка 1500 тг.' },
  ]);
});

test('lead with ai_enabled=false: message stored, no AI call, nothing sent', async () => {
  const { db, deps, sent, aiCalls } = setup();
  db.tables.leads.push({ id: 'lead-x', channel_id: 'ch1', external_id: '777', ai_enabled: false, attributes: {}, name: null, org_id: 'org1' });
  assert.equal(await processInstagramInbound(PAYLOAD, deps), 'ai_disabled');
  assert.equal(db.tables.messages.length, 1);
  assert.equal(aiCalls.length, 0);
  assert.equal(sent.length, 0);
});

test('unknown channel or channel without agent is ignored', async () => {
  const { db, deps } = setup();
  assert.equal(await processInstagramInbound({ ...PAYLOAD, channel_id: 'nope' }, deps), 'ignored');
  db.tables.channels[0].credentials = { provider: 'userbot' };
  assert.equal(await processInstagramInbound(PAYLOAD, deps), 'ignored');
});

test('send failure is reported as error and stops remaining parts', async () => {
  const sentParts: string[] = [];
  const { deps } = setup({
    runAgentTurnWithLead: async () =>
      ({ answer: 'a', messageParts: [{ text: 'first', delayMs: 0 }, { text: 'second', delayMs: 0 }], splitMessages: true, typingSimulation: false, usedChunks: [] }) as any,
    sendText: async (_a, _t, text) => {
      sentParts.push(text);
      throw new Error('worker down');
    },
  });
  assert.equal(await processInstagramInbound(PAYLOAD, deps), 'error');
  assert.deepEqual(sentParts, ['first']);
});

test('parseInstagramInboundPayload validates required fields', () => {
  assert.equal(parseInstagramInboundPayload(null), null);
  assert.equal(parseInstagramInboundPayload({ ...PAYLOAD, text: '   ' }), null);
  assert.equal(parseInstagramInboundPayload({ ...PAYLOAD, thread_id: undefined }), null);
  const parsed = parseInstagramInboundPayload({ ...PAYLOAD, sender_username: null });
  assert.equal(parsed?.message_id, 'm1');
  assert.equal(parsed?.sender_username, null);
});

test('signature: valid, tampered body, wrong secret, stale timestamp, missing headers', () => {
  const secret = 'worker-secret';
  const body = JSON.stringify(PAYLOAD);
  const ts = '1760000000';
  const signature = `sha256=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
  const base = { rawBody: body, signature, timestamp: ts, secret, nowSeconds: 1760000010 };

  assert.equal(verifyInstagramInboundSignature(base), true);
  assert.equal(verifyInstagramInboundSignature({ ...base, rawBody: body + ' ' }), false);
  assert.equal(verifyInstagramInboundSignature({ ...base, secret: 'other' }), false);
  assert.equal(verifyInstagramInboundSignature({ ...base, nowSeconds: 1760000000 + 3600 }), false);
  assert.equal(verifyInstagramInboundSignature({ ...base, signature: null }), false);
  assert.equal(verifyInstagramInboundSignature({ ...base, secret: '' }), false);
  assert.equal(verifyInstagramInboundSignature({ ...base, timestamp: 'abc' }), false);
});
