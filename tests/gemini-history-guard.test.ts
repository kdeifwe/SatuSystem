import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeGeminiContentsForHistory } from '../lib/server/ai/providers/gemini-provider.ts';

test('Gemini history never ends with a model turn', () => {
  const contents = normalizeGeminiContentsForHistory([
    { role: 'user', parts: [{ text: 'Привет' }] },
    { role: 'model', parts: [{ text: 'Привет! Чем могу помочь?' }] },
    { role: 'user', parts: [{ text: 'Нужно записать встречу' }] },
    { role: 'model', parts: [{ text: 'Хорошо, запишу' }] },
  ]);

  assert.equal(contents.length, 4);
  assert.equal(contents[0].role, 'user');
  assert.equal(contents[1].role, 'model');
  assert.equal(contents[2].role, 'user');
  assert.equal(contents[3].role, 'user');
  assert.equal(contents[3].parts[0].text, 'Хорошо, запишу');
  assert.equal(contents.every((content) => content.role !== 'model' || content !== contents[contents.length - 1]), true);
});
