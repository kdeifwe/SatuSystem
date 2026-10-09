import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from '../lib/server/crypto.ts';
import { buildGoogleOAuthState, verifyGoogleOAuthState } from '../lib/server/google-oauth-state.ts';
import { computeFreeSlots } from '../lib/google-calendar/slots.ts';
import { buildToolDeclarationsForAgent } from '../lib/ai/tools/registry.ts';
import { isSandboxToolAllowed } from '../lib/ai/tools/sandbox-allowlist.ts';
import { buildSystemPrompt } from '../lib/ai/compile-system-prompt.ts';

process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

test('encrypt/decrypt roundtrip succeeds and wrong key fails', () => {
  const original = 'refresh-token-abc';
  const encrypted = encryptSecret(original);
  assert.ok(encrypted.includes('v1:'));
  assert.equal(decryptSecret(encrypted), original);

  const saved = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.from('abcdef0123456789abcdef0123456789').toString('base64');
  assert.throws(() => decryptSecret(encrypted), /decrypt|key/i);
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = saved;
});

test('google OAuth state validates signature and expiry', () => {
  const secret = 'google-oauth-secret';
  const state = buildGoogleOAuthState('agent-1', 'user-42', secret);
  assert.equal(verifyGoogleOAuthState(state, 'agent-1', 'user-42', secret), true);
  assert.equal(verifyGoogleOAuthState(`${state}x`, 'agent-1', 'user-42', secret), false);
  assert.equal(verifyGoogleOAuthState(state, 'agent-1', 'other-user', secret), false);
});

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

test('calendar tool declarations are gated by capability and sandbox blocks write tools', () => {
  const originalClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const originalClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const originalKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;

  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

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
    if (originalClientId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID; else process.env.GOOGLE_OAUTH_CLIENT_ID = originalClientId;
    if (originalClientSecret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET; else process.env.GOOGLE_OAUTH_CLIENT_SECRET = originalClientSecret;
    if (originalKey === undefined) delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY; else process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = originalKey;
  }

  assert.equal(isSandboxToolAllowed('checkCalendarAvailability'), true);
  assert.equal(isSandboxToolAllowed('createCalendarEvent'), false);
  assert.equal(isSandboxToolAllowed('cancelCalendarEvent'), false);
});

test('prompt includes calendar safety policy only for enabled agents and preserves original prompt otherwise', () => {
  const originalClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const originalClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const originalKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;

  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

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
    if (originalClientId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID; else process.env.GOOGLE_OAUTH_CLIENT_ID = originalClientId;
    if (originalClientSecret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET; else process.env.GOOGLE_OAUTH_CLIENT_SECRET = originalClientSecret;
    if (originalKey === undefined) delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY; else process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = originalKey;
  }
});
