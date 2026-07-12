import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inferCurrentNodeIdFromMessages } from '../lib/funnel/backfill.ts';

test('infers current node from latest advanceFunnelStep tool call', () => {
  const flow = {
    entryNodeId: 'greeting',
    nodes: [{ id: 'greeting' }, { id: 'offer' }, { id: 'closing' }],
  };

  const currentNodeId = inferCurrentNodeIdFromMessages(
    [
      { role: 'user', content: 'Привет' },
      {
        role: 'assistant',
        content: 'Давайте обсудим предложение',
        tool_calls: [{ name: 'advanceFunnelStep', args: { stepId: 'offer', reason: 'client_ready' } }],
      },
    ],
    flow
  );

  assert.equal(currentNodeId, 'offer');
});

test('falls back to a later node when no tool calls are present', () => {
  const flow = {
    entryNodeId: 'greeting',
    nodes: [{ id: 'greeting' }, { id: 'offer' }, { id: 'closing' }],
  };

  const currentNodeId = inferCurrentNodeIdFromMessages(
    [
      { role: 'assistant', content: 'Привет' },
      { role: 'user', content: 'Хочу узнать цену' },
      { role: 'assistant', content: 'Вот предложение' },
    ],
    flow
  );

  assert.equal(currentNodeId, 'offer');
});

test('prefers durable funnel state over the message-count fallback', () => {
  const flow = {
    entryNodeId: 'greeting',
    nodes: [{ id: 'greeting' }, { id: 'offer' }, { id: 'closing' }],
  };

  const currentNodeId = inferCurrentNodeIdFromMessages(
    [
      { role: 'assistant', content: 'Привет' },
      { role: 'user', content: 'Хочу узнать цену' },
      { role: 'assistant', content: 'Вот предложение' },
    ],
    flow,
    { currentFunnelStep: 'closing' }
  );

  assert.equal(currentNodeId, 'closing');
});

test('does not invent a node for empty history', () => {
  const flow = {
    entryNodeId: 'greeting',
    nodes: [{ id: 'greeting' }, { id: 'offer' }, { id: 'closing' }],
  };

  const currentNodeId = inferCurrentNodeIdFromMessages([], flow);

  assert.equal(currentNodeId, null);
});
