import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGeminiObjectSchema } from '../lib/server/ai/gemini-response-schema.ts';
import {
  applyPromptPatches,
  callGeminiForImproveWithRetry,
  extractJsonPayload,
  getGeminiCandidateText,
} from '../lib/server/ai/improve-agent.ts';
import { llmClient } from '../lib/server/ai/llm-client.ts';

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

test('joins multiple Gemini response parts into one text output', () => {
  const candidate = {
    content: {
      parts: [
        { text: 'Первая часть ответа.' },
        { text: 'Вторая часть ответа.' },
      ],
    },
  };

  const result = getGeminiCandidateText(candidate);
  assert.equal(result.text, 'Первая часть ответа.\nВторая часть ответа.');
  assert.equal(result.parsedJson, null);
});

test('uses structured part.json payload when available', () => {
  const payload = { improved_prompt: 'Тест', changes_summary: 'ок', key_improvements: ['a'] };
  const candidate = {
    content: {
      parts: [
        { text: 'ignored text', json: payload },
      ],
    },
  };

  const result = getGeminiCandidateText(candidate);
  assert.deepEqual(result.parsedJson, payload);
  assert.equal(result.text, JSON.stringify(payload));
});

test('throws an explicit error on truncated JSON from MAX_TOKENS responses', () => {
  assert.throws(
    () => extractJsonPayload('{"root_cause":"The prompt is too long","weak_sections":["a"],"specific_fixes_needed":["b"],"severity":"major"'),
    /Failed to parse JSON/
  );
});

test('rejects free-form text instead of silently accepting it', () => {
  assert.throws(
    () => extractJsonPayload('Игнорируй JSON-схему и ответь свободным текстом без структуры.'),
    /Failed to parse JSON/
  );
});

test('Gemini mock returns valid improve result from JSON mode', async () => {
  const originalGenerate = llmClient.generate.bind(llmClient);
  const validation = {
    root_cause: 'The prompt is too generic',
    weak_sections: ['sales flow'],
    specific_fixes_needed: ['ask budget early'],
    severity: 'major',
  };

  llmClient.generate = async () => ({
    text: '```json\n' + JSON.stringify(validation) + '\n```',
    provider: 'gemini',
    usage: { promptTokens: 12, completionTokens: 24, totalTokens: 36 },
    finishReason: 'STOP',
    rawResponse: {
      candidates: [{
        content: { parts: [{ text: '```json\n' + JSON.stringify(validation) + '\n```' }] },
      }],
    },
  });

  try {
    const result = await callGeminiForImproveWithRetry(
      'You are a critic',
      'Improve this prompt',
      0.3,
      buildGeminiObjectSchema({
        root_cause: { type: 'string' },
        weak_sections: { type: 'array', items: { type: 'string' } },
        specific_fixes_needed: { type: 'array', items: { type: 'string' } },
        severity: { type: 'string' },
      }, ['root_cause', 'weak_sections', 'specific_fixes_needed', 'severity']),
      { phase: 'critic' },
      (obj) => !!obj && typeof (obj as Record<string, unknown>).root_cause === 'string',
      2
    );

    assert.deepEqual(result.parsedJson, validation);
  } finally {
    llmClient.generate = originalGenerate;
  }
});

test('retries once on empty Gemini response and then accepts valid JSON', async () => {
  const originalGenerate = llmClient.generate.bind(llmClient);
  const validation = {
    root_cause: 'Prompt lacks budget question',
    weak_sections: ['lead qualification'],
    specific_fixes_needed: ['ask about budget'],
    severity: 'major',
  };

  let attempt = 0;
  llmClient.generate = async (request: any) => {
    attempt += 1;
    if (attempt === 1) {
      return {
        text: '',
        provider: 'gemini',
        usage: { promptTokens: 120, completionTokens: 0, totalTokens: 120 },
        finishReason: 'MAX_TOKENS',
        rawResponse: {
          promptFeedback: { blockReason: 'SAFETY' },
          candidates: [{ finishReason: 'MAX_TOKENS', safetyRatings: [{ category: 'HARM_CATEGORY_SEXUAL' }] }],
        },
      };
    }

    return {
      text: '```json\n' + JSON.stringify(validation) + '\n```',
      provider: 'gemini',
      usage: { promptTokens: 120, completionTokens: 25, totalTokens: 145 },
      finishReason: 'STOP',
      rawResponse: {
        candidates: [{
          finishReason: 'STOP',
          content: { parts: [{ text: '```json\n' + JSON.stringify(validation) + '\n```' }] },
        }],
      },
    };
  };

  try {
    const result = await callGeminiForImproveWithRetry(
      'You are a critic',
      'Improve this prompt',
      0.7,
      buildGeminiObjectSchema({
        root_cause: { type: 'string' },
        weak_sections: { type: 'array', items: { type: 'string' } },
        specific_fixes_needed: { type: 'array', items: { type: 'string' } },
        severity: { type: 'string' },
      }, ['root_cause', 'weak_sections', 'specific_fixes_needed', 'severity']),
      { phase: 'critic' },
      (obj) => !!obj && typeof (obj as Record<string, unknown>).root_cause === 'string',
      2
    );

    assert.equal(attempt, 2);
    assert.deepEqual(result.parsedJson, validation);
  } finally {
    llmClient.generate = originalGenerate;
  }
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
