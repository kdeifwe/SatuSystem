import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getEmptyResponseFallbackMessage } from '../lib/server/ai/handoff';
import { buildSystemPrompt } from '../lib/ai/compile-system-prompt.ts';

test('empty response fallback uses a clarification message instead of a handoff message', () => {
  assert.equal(getEmptyResponseFallbackMessage(), 'Сейчас уточню информацию и вернусь с ответом.');
});

test('system prompt forbids operator escalation for missing product details', () => {
  const prompt = buildSystemPrompt(
    {
      id: 'agent-1',
      name: 'Алиса',
      role: 'менеджер по продажам',
      goal: 'Помогать клиентам',
      tone_of_voice: 'дружелюбный',
      human_communication_style: 'живой стиль',
      communication_rules: '1. Быть вежливым',
      knowledge_base_principles: 'Используй базу знаний',
      dialogue_flow: { steps: ['Приветствие'] },
      general_capabilities: { can_send_files: true },
    },
    { name: 'ТехноПлюс', timezone: 'Asia/Almaty', currency: 'KZT' },
    []
  );

  assert.match(prompt, /НИКОГДА не переключай на оператора только потому что не знаешь цену, наличие или характеристику/i);
  assert.match(prompt, /переключай на оператора ТОЛЬКО если клиент явно просит/i);
});
