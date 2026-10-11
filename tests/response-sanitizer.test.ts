import { strict as assert } from 'assert';
import { test } from 'node:test';
import { sanitizeAgentReply, extractTextToolCalls } from '../lib/ai/response-sanitizer.ts';

test('sanitizeAgentReply strips outer markdown code fences and preserves normal text', () => {
  assert.equal(sanitizeAgentReply('Спасибо, я отправляю счёт.'), 'Спасибо, я отправляю счёт.');
  assert.equal(sanitizeAgentReply('```'), '');
  assert.equal(sanitizeAgentReply('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(sanitizeAgentReply('```\nПривет\n```'), 'Привет');
  assert.equal(sanitizeAgentReply('   ```\nПривет\n```   '), 'Привет');
});

test('sanitizeAgentReply removes leaked tool placeholders', () => {
  assert.equal(
    sanitizeAgentReply('[Вызов инструмента getCurrentDate: {}]\nЗдравствуйте!'),
    'Здравствуйте!',
  );
  assert.equal(
    sanitizeAgentReply('Привет\n[Вызов инструмента checkCalendarAvailability: {"date":"2026-10-09"}]\n[Результат инструмента checkCalendarAvailability: {"ok":true}]\nКак дела?'),
    'Привет\nКак дела?',
  );
});

test('extractTextToolCalls parses sequential tool markers and invalid JSON', () => {
  const calls = extractTextToolCalls('[Вызов инструмента getCurrentDate: {"tz":"Asia/Almaty"}][Результат инструмента checkCalendarAvailability: {"ok":true}]\n[Вызов инструмента badTool: {broken}]');

  assert.deepEqual(calls, [
    { name: 'getCurrentDate', args: { tz: 'Asia/Almaty' } },
    { name: 'checkCalendarAvailability', args: { ok: true } },
    { name: 'badTool', args: {} },
  ]);
});
