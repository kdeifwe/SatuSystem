import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGeminiObjectSchema } from '../lib/server/ai/gemini-response-schema.ts';
import { applyPromptPatches, extractJsonPayload } from '../lib/server/ai/improve-agent.ts';

test('extracts JSON from fenced markdown responses', () => {
  const raw = 'Вот результат:\n\n```json\n{"improved_prompt":"Тест","changes_summary":"обновлено","key_improvements":["один"]}\n```\n\nГотово.';

  assert.deepEqual(extractJsonPayload(raw), {
    improved_prompt: 'Тест',
    changes_summary: 'обновлено',
    key_improvements: ['один'],
  });
});

test('extracts JSON when the response contains explanatory text before and after', () => {
  const raw = 'Ниже JSON:\n{"improved_prompt":"Промпт","changes_summary":"сделано","key_improvements":["a","b"]}\nСпасибо.';

  assert.deepEqual(extractJsonPayload(raw), {
    improved_prompt: 'Промпт',
    changes_summary: 'сделано',
    key_improvements: ['a', 'b'],
  });
});

test('rejects free-form text instead of silently accepting it', () => {
  assert.throws(
    () => extractJsonPayload('Игнорируй JSON-схему и ответь свободным текстом без структуры.'),
    /Failed to parse JSON/
  );
});

test('applies valid prompt patches sequentially', () => {
  const currentPrompt = 'Ты агент.\n\nПРАВИЛА:\n- Будь вежлив.\n\nСЕКЦИЯ: продажа';
  const patches = [
    { search: 'ПРАВИЛА:\n- Будь вежлив.', replace: 'ПРАВИЛА:\n- Будь вежлив.\n- Задавай вопросы о бюджете.', reason: 'add budget question' },
    { search: 'СЕКЦИЯ: продажа', replace: 'СЕКЦИЯ: продажа\nОБЯЗАТЕЛЬНО: уточняй тарифы.', reason: 'add pricing instruction' },
  ];

  const result = applyPromptPatches(currentPrompt, patches);

  assert.match(result, /Задавай вопросы о бюджете/);
  assert.match(result, /ОБЯЗАТЕЛЬНО: уточняй тарифы/);
});

test('rejects patches that do not match exactly once', () => {
  const currentPrompt = 'Один\nОдин\nТри';
  const patches = [{ search: 'Один', replace: 'Два', reason: 'replace duplicate' }];

  assert.throws(
    () => applyPromptPatches(currentPrompt, patches),
    /Patch #1 failed: search fragment must appear exactly once/
  );
});

test('builds Gemini-compatible object schemas without unsupported fields', () => {
  const schema = buildGeminiObjectSchema({
    answer: { type: 'string' },
    confidence: { type: 'number' },
  }, ['answer']);

  assert.equal(schema.type, 'object');
  assert.deepEqual(schema.required, ['answer']);
  assert.equal('additionalProperties' in schema, false);
});
