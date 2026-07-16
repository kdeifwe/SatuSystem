import assert from 'node:assert';
import { test } from 'node:test';
import { resolveChunkGrades } from '../lib/knowledge-base/search.ts';

test('resolveChunkGrades parses numeric grade labels correctly', () => {
  assert.deepEqual(resolveChunkGrades({ tag: '11' }, null), [11]);
  assert.deepEqual(resolveChunkGrades({ tag: '9 и 10' }, null), [9, 10]);
  assert.deepEqual(resolveChunkGrades({ tag: '9,10 классы' }, null), [9, 10]);
  assert.deepEqual(resolveChunkGrades(null, null), null);
  assert.deepEqual(resolveChunkGrades({ tag: '' }, { tag: '' }), null);
  assert.deepEqual(resolveChunkGrades({ tag: '11' }, { tag: '9 и 10' }), [11]);
  assert.deepEqual(resolveChunkGrades(null, { tag: '9 и 10' }), [9, 10]);
});
