import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAgentPatchPayload, canManageAgentRole, hasPromptAffectingChanges } from '@/lib/server/agents/access';

test('buildAgentPatchPayload only allows safe fields and strips reserved values', () => {
  const payload = buildAgentPatchPayload({
    id: 'should-not-pass',
    org_id: 'should-not-pass',
    created_at: 'should-not-pass',
    name: 'Новый агент',
    goal: 'Помогать',
    system_prompt_compiled: 'blocked',
  });

  assert.deepEqual(payload, {
    name: 'Новый агент',
    goal: 'Помогать',
  });
});

test('prompt recompilation is triggered for prompt-affecting fields', () => {
  assert.equal(hasPromptAffectingChanges({ goal: 'Новая цель' }), true);
  assert.equal(hasPromptAffectingChanges({ is_active: false }), false);
});

test('only owner or admin can manage agent records', () => {
  assert.equal(canManageAgentRole('owner'), true);
  assert.equal(canManageAgentRole('admin'), true);
  assert.equal(canManageAgentRole('member'), false);
  assert.equal(canManageAgentRole(null), false);
});
