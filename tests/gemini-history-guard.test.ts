import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeGeminiContentsForHistory } from '../lib/server/ai/providers/gemini-provider.ts';

test('Gemini history warns on trailing model turns without mutating the original order', () => {
  const contents = normalizeGeminiContentsForHistory([
    { role: 'user', parts: [{ text: 'Привет' }] },
    { role: 'model', parts: [{ text: 'Привет! Чем могу помочь?' }] },
    { role: 'user', parts: [{ text: 'Нужно записать встречу' }] },
    { role: 'model', parts: [{ text: 'Хорошо, запишу' }] },
  ]);

  assert.deepEqual(
    contents.map((content) => content.role),
    ['user', 'model', 'user', 'model'],
  );
  assert.equal(contents[3].parts[0].text, 'Хорошо, запишу');
});
