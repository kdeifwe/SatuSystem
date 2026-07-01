import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCategoriesSummary, buildCategorizationPrompt, KB_CATEGORIES } from '../lib/ai/knowledge/categories.ts';

test('buildCategoriesSummary returns all categories with zeroed defaults', () => {
  const summary = buildCategoriesSummary(['product', 'faq', 'product', 'other']);

  assert.deepEqual(summary, {
    product: 2,
    faq: 1,
    procedure: 0,
    contact: 0,
    file: 0,
    other: 1,
  });
});

test('buildCategorizationPrompt includes the full category list', () => {
  const prompt = buildCategorizationPrompt(['Цена 1000', 'Как вернуть товар?']);
  assert.match(prompt, /product/);
  assert.match(prompt, /faq/);
  assert.match(prompt, /contact/);
  assert.ok(KB_CATEGORIES.includes('product'));
});
