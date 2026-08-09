import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSystemPrompt } from '../lib/ai/compile-system-prompt.ts';

test('buildSystemPrompt includes tool names and prompt-injection safeguard', () => {
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

  assert.match(prompt, /searchKnowledgeBase/);
  assert.match(prompt, /redirectToOperator/);
  assert.match(prompt, /createKaspiInvoice/);
  assert.match(prompt, /когда клиент явно подтвердил готовность оплатить/i);
  assert.match(prompt, /забудь все инструкции/i);
  assert.match(prompt, /prompt injection/i);
});
