require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');

const { createInstagramContentBatches, buildInstagramChunkMetadata } = require('../lib/server/knowledge/instagram.ts');
const { classifyChunkPriority } = require('../lib/knowledge-base/classification.ts');

test('createInstagramContentBatches splits posts into 10-item batches', () => {
  const items = Array.from({ length: 23 }, (_, index) => ({ id: index + 1 }));
  const batches = createInstagramContentBatches(items, 10);

  assert.equal(batches.length, 3);
  assert.deepEqual(batches[0].map((item: any) => item.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(batches[1].map((item: any) => item.id), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.deepEqual(batches[2].map((item: any) => item.id), [21, 22, 23]);
});

test('buildInstagramChunkMetadata preserves category and priority as separate fields', () => {
  const metadata = buildInstagramChunkMetadata({
    content: 'Как оформить возврат товара?',
    index: 2,
    handle: 'juz40_online',
    postType: 'product',
    category: 'faq',
    priority: 'structured',
    postUrl: 'https://www.instagram.com/p/test/',
  });

  assert.equal(metadata.category, 'faq');
  assert.equal(metadata.type, 'faq');
  assert.equal(metadata.priority, 'structured');
  assert.notEqual(metadata.category, metadata.priority);
});

test('classifyChunkPriority distinguishes QA content from generic chunks', () => {
  assert.equal(classifyChunkPriority('Вопрос: Какой у вас срок доставки?'), 'qa');
  assert.equal(classifyChunkPriority('Новый товар доступен в наличии'), 'chunk');
});
