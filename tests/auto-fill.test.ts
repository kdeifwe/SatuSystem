import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAutoFillPrompt, normalizeAutoFillPayload } from '../lib/server/ai/auto-fill';

test('buildAutoFillPrompt includes the new business fields', () => {
  const prompt = buildAutoFillPrompt('Привет');

  assert.match(prompt, /targetAudience/i);
  assert.match(prompt, /firstQuestion/i);
  assert.match(prompt, /commonObjections/i);
  assert.match(prompt, /companyDescription/i);
  assert.match(prompt, /goal/i);
  assert.match(prompt, /advantages/i);
});

test('normalizeAutoFillPayload preserves arrays and strings', () => {
  const payload = normalizeAutoFillPayload({
    companyDescription: 'Компания делает курсы',
    goal: 'Найти клиентов',
    advantages: 'Низкая цена\nБыстрое обучение',
    targetAudience: 'Родители детей 8-14',
    firstQuestion: 'Для какого класса нужен курс?',
    commonObjections: ['Слишком дорого', 'Нужно подумать'],
  });

  assert.equal(payload.companyDescription, 'Компания делает курсы');
  assert.equal(payload.goal, 'Найти клиентов');
  assert.equal(payload.advantages, 'Низкая цена\nБыстрое обучение');
  assert.equal(payload.targetAudience, 'Родители детей 8-14');
  assert.equal(payload.firstQuestion, 'Для какого класса нужен курс?');
  assert.deepEqual(payload.commonObjections, ['Слишком дорого', 'Нужно подумать']);
});
