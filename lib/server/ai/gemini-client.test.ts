import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeGeminiModelName } from './gemini-client';

test('normalizeGeminiModelName trims whitespace, quotes and models/ prefix', () => {
  assert.equal(normalizeGeminiModelName('  "models/gemini-2.5-flash"  '), 'gemini-2.5-flash');
  assert.equal(normalizeGeminiModelName('models/gemini-embedding-2'), 'gemini-embedding-2');
  assert.equal(normalizeGeminiModelName('gemini-2.5-flash'), 'gemini-2.5-flash');
});

test('normalizeGeminiModelName handles empty values safely', () => {
  assert.equal(normalizeGeminiModelName(undefined), '');
  assert.equal(normalizeGeminiModelName(null), '');
});
