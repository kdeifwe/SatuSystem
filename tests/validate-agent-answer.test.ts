import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAgentAnswer } from '../lib/ai/validate-output';

test('accepts a simple friendly reply in production mode', () => {
  assert.deepEqual(validateAgentAnswer('Здравствуйте, вот что я могу предложить:\n- вариант 1'), { valid: true, errors: [] });
});

test('rejects empty replies', () => {
  assert.deepEqual(validateAgentAnswer('   '), {
    valid: false,
    errors: ['Ответ пустой'],
  });
});
