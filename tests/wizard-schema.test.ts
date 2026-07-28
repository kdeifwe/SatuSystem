import test from 'node:test';
import assert from 'node:assert/strict';

import { wizardPayloadSchema, parseWizardPayload } from '../lib/server/ai/wizard-schema';

test('wizard payload schema accepts partial drafts and applies defaults', () => {
  const draft = {
    agentName: 'Айгерим',
    companyName: 'SatuSystem',
    companyDescription: 'AI sales assistant',
    goal: 'Qualify leads',
    advantages: 'Fast replies',
    business: {
      scenario: 'sales',
      firstQuestion: 'Какой у вас бюджет?',
      commonObjections: ['цена', 'срок'],
    },
    funnel: {
      steps: [{ id: 'welcome', title: 'Приветствие', triggerDescription: 'client opens chat', sampleMessage: 'Здравствуйте', order: 1 }],
    },
    behavior: {
      handoffTriggers: ['жалоба'],
      neverSayPhrases: ['я ИИ'],
      allowedTools: ['searchKnowledgeBase'],
      responseDelayMs: 500,
      followUpEnabled: true,
    },
    channels: {
      enabled: { whatsapp: true, telegram: false, instagram: false, web: true },
    },
  };

  const parsed = parseWizardPayload(draft);

  assert.equal(parsed.agentName, 'Айгерим');
  assert.equal(parsed.business.scenario, 'sales');
  assert.equal(parsed.advanced.model, 'gemini-2.5-flash');
  assert.equal(parsed.advanced.temperature, 0.4);
  assert.equal(parsed.advanced.topP, 0.9);
  assert.equal(parsed.channels.enabled.whatsapp, true);
  assert.equal(parsed.behavior.allowedTools[0], 'searchKnowledgeBase');
  assert.equal(parsed.funnel.steps[0].order, 1);
});

test('wizard payload schema accepts the snake_case tool names used by the UI', () => {
  const draft = {
    agentName: 'Sales Agent',
    companyName: 'SatuSystem',
    behavior: {
      allowedTools: ['searchKnowledgeBase', 'redirectToOperator', 'advanceFunnelStep', 'getCurrentDate', 'add_lead_note', 'update_lead_info', 'update_lead_status', 'scheduleMessage', 'createKaspiInvoice'],
    },
  };

  const parsed = parseWizardPayload(draft);

  assert.deepEqual(parsed.behavior.allowedTools, ['searchKnowledgeBase', 'redirectToOperator', 'advanceFunnelStep', 'getCurrentDate', 'add_lead_note', 'update_lead_info', 'update_lead_status', 'scheduleMessage', 'createKaspiInvoice']);
});
