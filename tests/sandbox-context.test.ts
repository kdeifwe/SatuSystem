import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConversationInsertData, buildSandboxConversationInsertData } from '../lib/ai/sandbox-context.ts';

test('buildConversationInsertData marks real conversations as non-sandbox by default', () => {
  const payload = buildConversationInsertData({ lead_id: 'lead-1', agent_id: 'agent-1' });

  assert.deepEqual(payload, {
    lead_id: 'lead-1',
    agent_id: 'agent-1',
    is_sandbox: false,
  });
});

test('buildSandboxConversationInsertData marks conversation as sandbox', () => {
  const payload = buildSandboxConversationInsertData({ lead_id: 'lead-1', agent_id: 'agent-1' });

  assert.deepEqual(payload, {
    lead_id: 'lead-1',
    agent_id: 'agent-1',
    is_sandbox: true,
  });
});
