import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStickyFactsContextMessage, buildStickyFactsFromChunks } from '../lib/server/ai/sticky-facts';

test('chunk similarity 0.65 is stored as sticky fact', () => {
  const result = buildStickyFactsFromChunks([], [{ chunk_id: 'chunk-1', content: 'Цены: 25000 тенге за курс', similarity: 0.65 }], 'msg-1');

  assert.equal(result.addedCount, 1);
  assert.equal(result.stickyFacts.length, 1);
  assert.equal(result.stickyFacts[0].chunkId, 'chunk-1');
  assert.equal(result.stickyFacts[0].content, 'Цены: 25000 тенге за курс');
  assert.equal(result.stickyFacts[0].addedAtMessageId, 'msg-1');
  assert.equal(typeof result.stickyFacts[0].addedAtTs, 'number');
});

test('same chunk id is not duplicated when it appears again', () => {
  const existing = [{
    chunkId: 'chunk-1',
    content: 'Цены: 25000 тенге за курс',
    similarity: 0.72,
    addedAtMessageId: null,
    addedAtTs: Date.now(),
  }];

  const result = buildStickyFactsFromChunks(existing, [{ chunk_id: 'chunk-1', content: 'Цены: 25000 тенге за курс', similarity: 0.72 }], 'msg-2');

  assert.equal(result.addedCount, 0);
  assert.equal(result.stickyFacts.length, 1);
  assert.equal(result.stickyFacts.filter((fact) => fact.chunkId === 'chunk-1').length, 1);
});

test('previous sticky facts remain in the next context even if the new query is irrelevant', () => {
  const previousFacts = [{
    chunkId: 'chunk-keep',
    content: 'Гарантия на курс — 12 месяцев.',
    similarity: 0.81,
    addedAtMessageId: null,
    addedAtTs: Date.now(),
  }];

  const result = buildStickyFactsFromChunks(previousFacts, [{ chunk_id: 'chunk-new', content: 'Сегодня солнечно и тепло', similarity: 0.1 }], 'msg-3');
  const context = buildStickyFactsContextMessage(result.stickyFacts);

  assert.equal(result.addedCount, 0);
  assert.equal(result.stickyFacts.length, 1);
  assert.ok(context);
  assert.match(context ?? '', /Гарантия на курс — 12 месяцев\./);
});
