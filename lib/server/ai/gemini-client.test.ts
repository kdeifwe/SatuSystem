import test from 'node:test';
import assert from 'node:assert/strict';

import { GEMINI_CHAT_MODEL, normalizeGeminiModelName, resolveGeminiModel } from './gemini-client';

test('normalizeGeminiModelName trims whitespace, quotes and models/ prefix', () => {
  assert.equal(normalizeGeminiModelName('  "models/gemini-2.5-flash"  '), 'gemini-2.5-flash');
  assert.equal(normalizeGeminiModelName('models/gemini-embedding-2'), 'gemini-embedding-2');
  assert.equal(normalizeGeminiModelName('gemini-2.5-flash'), 'gemini-2.5-flash');
});

test('resolveGeminiModel rewrites legacy Gemini 2.x names to the configured chat model', () => {
  assert.equal(resolveGeminiModel('gemini-2.5-flash'), GEMINI_CHAT_MODEL);
  assert.equal(resolveGeminiModel('models/gemini-2.0-flash'), GEMINI_CHAT_MODEL);
  assert.equal(resolveGeminiModel('gemini-3.5-flash'), 'gemini-3.5-flash');
});

test('normalizeGeminiModelName handles empty values safely', () => {
  assert.equal(normalizeGeminiModelName(undefined), '');
  assert.equal(normalizeGeminiModelName(null), '');
});
