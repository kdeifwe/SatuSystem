import assert from 'node:assert/strict';
import test from 'node:test';

import { isOpenAIFallbackAllowed } from '../lib/server/ai/openai-fallback.ts';

test('OpenAI fallback is disabled by default', () => {
  delete process.env.ALLOW_OPENAI_FALLBACK;
  assert.equal(isOpenAIFallbackAllowed(), false);
});

test('OpenAI fallback is only enabled when explicitly set', () => {
  process.env.ALLOW_OPENAI_FALLBACK = 'true';
  assert.equal(isOpenAIFallbackAllowed(), true);

  process.env.ALLOW_OPENAI_FALLBACK = 'false';
  assert.equal(isOpenAIFallbackAllowed(), false);

  delete process.env.ALLOW_OPENAI_FALLBACK;
});
