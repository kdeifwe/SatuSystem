import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeGeminiContentsForHistory } from '../lib/server/ai/providers/gemini-provider.ts';
import { normalizeGeminiContentsToLlmMessages } from '../lib/server/ai/gemini-message-normalizer.ts';

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

test('followUpHistory keeps tool results in history and ends with a user turn', () => {
  const history = [
    { role: 'user', parts: [{ text: 'Привет' }] },
    {
      role: 'model',
      parts: [
        { text: 'Сейчас уточню информацию…' },
        { functionCall: { name: 'searchKnowledgeBase', args: { query: 'цены' } } },
      ],
    },
    {
      role: 'user',
      parts: [{
        functionResponse: {
          name: 'searchKnowledgeBase',
          response: { results: [{ snippet: 'Цена 5000' }] },
        },
      }],
    },
  ];

  const messages = normalizeGeminiContentsToLlmMessages(history);

  assert.deepEqual(
    messages.map((message) => message.role),
    ['user', 'assistant', 'user'],
  );
  assert.ok(messages.at(-1)?.content.includes('searchKnowledgeBase'));
  assert.ok(messages.at(-1)?.content.includes('Цена 5000'));
});
