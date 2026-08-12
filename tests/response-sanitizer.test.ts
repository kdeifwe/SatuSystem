import { strict as assert } from 'assert';
import { test } from 'node:test';
import { sanitizeAgentReply } from '../lib/ai/response-sanitizer.ts';

test('sanitizeAgentReply strips outer markdown code fences and preserves normal text', () => {
  assert.equal(sanitizeAgentReply('Спасибо, я отправляю счёт.'), 'Спасибо, я отправляю счёт.');
  assert.equal(sanitizeAgentReply('```'), '');
  assert.equal(sanitizeAgentReply('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(sanitizeAgentReply('```\nПривет\n```'), 'Привет');
  assert.equal(sanitizeAgentReply('   ```\nПривет\n```   '), 'Привет');
});
