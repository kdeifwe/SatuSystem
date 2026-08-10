import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildToolFailureFallbackMessage, getToolExecutionPolicy } from '../lib/server/ai/orchestrator.ts';

test('reuses the same tool only once per turn after a previous attempt', () => {
  const policy = getToolExecutionPolicy('createKaspiInvoice', { createKaspiInvoice: 1 });

  assert.equal(policy.shouldExecute, false);
  assert.match(policy.reason ?? '', /already used once/i);
});

test('builds a non-promissory fallback when a billing tool fails', () => {
  const fallback = buildToolFailureFallbackMessage([
    { name: 'createKaspiInvoice', error: 'missing phone' },
  ]);

  assert.match(fallback ?? '', /не получается оформить автоматически/i);
  assert.match(fallback ?? '', /уточню данные/i);
});

test('does not force a fallback when searchKnowledgeBase errors', () => {
  const fallback = buildToolFailureFallbackMessage([
    { name: 'searchKnowledgeBase', error: 'timeout' },
  ]);

  assert.equal(fallback, null);
});
