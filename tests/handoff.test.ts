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
  assert.match(section, /Клиент явно просит человека или оператора \(например: "дайте оператора", "хочу поговорить с человеком"\)/);
  assert.match(section, /Ты не нашёл ответ в базе знаний 2 раза подряд/);
  assert.doesNotMatch(section, /сильную злость, угрозы или серьёзную жалобу/);
  assert.match(section, /Подключаю сотрудника, он уже видит наш диалог/);
  assert.match(section, /Новый диалог требует внимания/);
});

test('buildHandoffPromptSection does not add unrelated bullet when no triggers enabled', () => {
  const config = normalizeHandoffConfig({
    enabled: true,
    triggers: {
      explicit_request: false,
      anger_complaint: false,
      no_answer_after_two_searches: false,
      asks_if_bot: false,
    },
    client_message: 'Подключаю сотрудника, он уже видит наш диалог',
    operator_message: 'Новый диалог требует внимания',
  });

  const section = buildHandoffPromptSection(config);

  assert.match(section, /- авто-передача включена, но не активировано ни одного триггера/);
  assert.doesNotMatch(section, /вне твоих полномочий/);
});
