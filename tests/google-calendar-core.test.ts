import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFreeSlots } from '../lib/google-calendar/slots.ts';
import { buildToolDeclarationsForAgent } from '../lib/ai/tools/registry.ts';
import { isSandboxToolAllowed } from '../lib/ai/tools/sandbox-allowlist.ts';
import { buildSystemPrompt } from '../lib/ai/compile-system-prompt.ts';
import { CalendarNotConnectedError, getCalendarClientForAgent } from '../lib/google-calendar/client.ts';

test('computeFreeSlots respects working hours, buffer, min_notice and day boundaries', () => {
  const slots = computeFreeSlots({
    date: '2026-10-09',
    timezone: 'Asia/Almaty',
    workingHours: {
      mon: [['09:00', '18:00']],
      tue: [['09:00', '18:00']],
      wed: [['09:00', '18:00']],
      thu: [['09:00', '18:00']],
      fri: [['09:00', '18:00']],
      sat: [],
      sun: [],
    },
    busy: [
      { start: '2026-10-09T10:00:00', end: '2026-10-09T11:00:00' },
      { start: '2026-10-09T15:30:00', end: '2026-10-09T15:45:00' },
    ],
    slotMinutes: 60,
    bufferMinutes: 15,
    minNoticeMinutes: 60,
    now: new Date('2026-10-08T12:00:00+06:00'),
    maxDaysAhead: 30,
  });

  assert.ok(slots.length > 0);
  const first = slots[0];
  assert.ok(first.start.includes('09:00') || first.start.includes('11:00'));
  assert.ok(slots.some((slot) => slot.start.includes('11:00')));
});

test('service-account client throws when calendar env is missing', () => {
  const previousEmail = process.env.GOOGLE_SA_EMAIL;
  const previousPrivateKey = process.env.GOOGLE_SA_PRIVATE_KEY;
  const previousCalendarId = process.env.GOOGLE_CALENDAR_ID;

  delete process.env.GOOGLE_SA_EMAIL;
  delete process.env.GOOGLE_SA_PRIVATE_KEY;
  delete process.env.GOOGLE_CALENDAR_ID;

  try {
    assert.rejects(() => getCalendarClientForAgent('agent-1'), CalendarNotConnectedError);
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SA_EMAIL; else process.env.GOOGLE_SA_EMAIL = previousEmail;
    if (previousPrivateKey === undefined) delete process.env.GOOGLE_SA_PRIVATE_KEY; else process.env.GOOGLE_SA_PRIVATE_KEY = previousPrivateKey;
    if (previousCalendarId === undefined) delete process.env.GOOGLE_CALENDAR_ID; else process.env.GOOGLE_CALENDAR_ID = previousCalendarId;
  }
});

test('calendar tool declarations are gated by capability and sandbox blocks write tools', () => {
  const originalEmail = process.env.GOOGLE_SA_EMAIL;
  const originalPrivateKey = process.env.GOOGLE_SA_PRIVATE_KEY;
  const originalCalendarId = process.env.GOOGLE_CALENDAR_ID;

  process.env.GOOGLE_SA_EMAIL = 'service-account@test.example';
  process.env.GOOGLE_SA_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----\n';
  process.env.GOOGLE_CALENDAR_ID = 'primary';

  try {
    const hiddenWithoutFlag = buildToolDeclarationsForAgent(['checkCalendarAvailability', 'createCalendarEvent', 'cancelCalendarEvent'], { google_calendar_enabled: false }, null, []);
    assert.equal(hiddenWithoutFlag.some((tool) => tool.name === 'checkCalendarAvailability'), false);
    assert.equal(hiddenWithoutFlag.some((tool) => tool.name === 'createCalendarEvent'), false);
    assert.equal(hiddenWithoutFlag.some((tool) => tool.name === 'cancelCalendarEvent'), false);

    const visibleWhenEnabledAndAllowed = buildToolDeclarationsForAgent(['checkCalendarAvailability', 'createCalendarEvent', 'cancelCalendarEvent'], { google_calendar_enabled: true }, null, []);
    assert.equal(visibleWhenEnabledAndAllowed.some((tool) => tool.name === 'checkCalendarAvailability'), true);
    assert.equal(visibleWhenEnabledAndAllowed.some((tool) => tool.name === 'createCalendarEvent'), true);
    assert.equal(visibleWhenEnabledAndAllowed.some((tool) => tool.name === 'cancelCalendarEvent'), true);

    const hiddenWhenEnabledWithoutAllowList = buildToolDeclarationsForAgent([], { google_calendar_enabled: true }, null, []);
    assert.equal(hiddenWhenEnabledWithoutAllowList.some((tool) => tool.name === 'checkCalendarAvailability'), false);
    assert.equal(hiddenWhenEnabledWithoutAllowList.some((tool) => tool.name === 'createCalendarEvent'), false);
    assert.equal(hiddenWhenEnabledWithoutAllowList.some((tool) => tool.name === 'cancelCalendarEvent'), false);
  } finally {
    if (originalEmail === undefined) delete process.env.GOOGLE_SA_EMAIL; else process.env.GOOGLE_SA_EMAIL = originalEmail;
    if (originalPrivateKey === undefined) delete process.env.GOOGLE_SA_PRIVATE_KEY; else process.env.GOOGLE_SA_PRIVATE_KEY = originalPrivateKey;
    if (originalCalendarId === undefined) delete process.env.GOOGLE_CALENDAR_ID; else process.env.GOOGLE_CALENDAR_ID = originalCalendarId;
  }

  assert.equal(isSandboxToolAllowed('checkCalendarAvailability'), true);
  assert.equal(isSandboxToolAllowed('createCalendarEvent'), false);
  assert.equal(isSandboxToolAllowed('cancelCalendarEvent'), false);
});

test('prompt includes calendar safety policy only for enabled agents and preserves original prompt otherwise', () => {
  const originalEmail = process.env.GOOGLE_SA_EMAIL;
  const originalPrivateKey = process.env.GOOGLE_SA_PRIVATE_KEY;
  const originalCalendarId = process.env.GOOGLE_CALENDAR_ID;

  process.env.GOOGLE_SA_EMAIL = 'service-account@test.example';
  process.env.GOOGLE_SA_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----\n';
  process.env.GOOGLE_CALENDAR_ID = 'primary';

  try {
    const org = {
      name: 'Company',
      timezone: 'Asia/Almaty',
      currency: 'KZT',
      agent_defaults: {},
    };

    const enabledAgentPrompt = buildSystemPrompt({
      id: 'agent-1',
      name: 'Test Agent',
      role: 'assistant',
      goal: 'Sell',
      tone_of_voice: null,
      human_communication_style: null,
      communication_rules: null,
      knowledge_base_principles: null,
      dialogue_flow: null,
      general_capabilities: {
        allowed_tools: ['checkCalendarAvailability', 'createCalendarEvent', 'cancelCalendarEvent'],
        google_calendar_enabled: true,
      },
    }, org);

    assert.match(enabledAgentPrompt, /Google Calendar tools are available only when/);
    assert.match(enabledAgentPrompt, /checkCalendarAvailability/);

    const disabledAgentPrompt = buildSystemPrompt({
      id: 'agent-1',
      name: 'Test Agent',
      role: 'assistant',
      goal: 'Sell',
      tone_of_voice: null,
      human_communication_style: null,
      communication_rules: null,
      knowledge_base_principles: null,
      dialogue_flow: null,
      general_capabilities: {
        allowed_tools: ['searchKnowledgeBase'],
        google_calendar_enabled: false,
      },
    }, org);

    assert.doesNotMatch(disabledAgentPrompt, /Google Calendar tools are available only when/);
    assert.doesNotMatch(disabledAgentPrompt, /checkCalendarAvailability/);

    const baselinePrompt = buildSystemPrompt({
      id: 'agent-1',
      name: 'Test Agent',
      role: 'assistant',
      goal: 'Sell',
      tone_of_voice: null,
      human_communication_style: null,
      communication_rules: null,
      knowledge_base_principles: null,
      dialogue_flow: null,
      general_capabilities: {
        allowed_tools: ['searchKnowledgeBase'],
      },
    }, org);

    assert.equal(disabledAgentPrompt, baselinePrompt);
  } finally {
    if (originalEmail === undefined) delete process.env.GOOGLE_SA_EMAIL; else process.env.GOOGLE_SA_EMAIL = originalEmail;
    if (originalPrivateKey === undefined) delete process.env.GOOGLE_SA_PRIVATE_KEY; else process.env.GOOGLE_SA_PRIVATE_KEY = originalPrivateKey;
    if (originalCalendarId === undefined) delete process.env.GOOGLE_CALENDAR_ID; else process.env.GOOGLE_CALENDAR_ID = originalCalendarId;
  }
});
