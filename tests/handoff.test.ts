import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildHandoffPromptSection, normalizeHandoffConfig } from '../lib/server/ai/handoff';

test('buildHandoffPromptSection includes enabled triggers and messages', () => {
  const config = normalizeHandoffConfig({
    enabled: true,
    triggers: {
      explicit_request: true,
      anger_complaint: false,
      no_answer_after_two_searches: true,
      asks_if_bot: false,
    },
    client_message: 'Подключаю сотрудника, он уже видит наш диалог',
    operator_message: 'Новый диалог требует внимания',
  });

  const section = buildHandoffPromptSection(config);

  assert.match(section, /<handoff_triggers>/);
  assert.match(section, /Клиент явно просит человека или оператора/);
  assert.match(section, /Агент не нашёл ответ 2 раза подряд/);
  assert.doesNotMatch(section, /Злость, угрозы или жалоба/);
  assert.match(section, /Подключаю сотрудника, он уже видит наш диалог/);
  assert.match(section, /Новый диалог требует внимания/);
});
