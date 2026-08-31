import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLeadIdForTool } from '../lib/ai/tools/executor.ts';

test('recordLeadSignal always uses the conversation lead id from context', () => {
  const context = {
    leadId: 'context-lead-id',
    agentId: 'agent-id',
    orgId: 'org-id',
    conversationId: 'conversation-id',
    isSandbox: false,
  };

  assert.equal(resolveLeadIdForTool('model-supplied-lead-id', context), 'context-lead-id');
  assert.equal(resolveLeadIdForTool(undefined, context), 'context-lead-id');
});
