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

test('does not force a fallback when only non-critical tools fail', () => {
  const fallback = buildToolFailureFallbackMessage([
    { name: 'searchKnowledgeBase', error: 'timeout' },
    { name: 'updateLeadStatus', error: 'invalid status' },
  ]);

  assert.equal(fallback, null);
});

test('does not mask a successful invoice when a non-critical tool fails in the same turn', () => {
  const toolResults = [
    { name: 'sendKaspiPay', result: { invoiceId: '123' }, error: undefined },
    { name: 'updateLeadStatus', result: null, error: 'Лид не найден или нет доступа' },
  ];

  assert.equal(buildToolFailureFallbackMessage(toolResults), null);
});

test('still reports failure when the critical tool itself fails and nothing critical succeeded', () => {
  const toolResults = [
    { name: 'sendKaspiPay', result: null, error: 'Kaspi bridge timeout' },
  ];

  assert.equal(
    buildToolFailureFallbackMessage(toolResults),
    'Счёт сейчас не получается оформить автоматически. Уточню данные и сразу напишу.',
  );
});
