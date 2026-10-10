import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

import { computeFreeSlots } from '../lib/google-calendar/slots.ts';
import { buildToolDeclarationsForAgent } from '../lib/ai/tools/registry.ts';
import { isSandboxToolAllowed } from '../lib/ai/tools/sandbox-allowlist.ts';
import { buildSystemPrompt } from '../lib/ai/compile-system-prompt.ts';
import { CalendarNotConnectedError, getCalendarClientForAgent } from '../lib/google-calendar/client.ts';
import { MAX_TOOL_ROUNDS, getToolLoopStateForTest, retryEmptyFinalAnswerWithoutTools } from '../lib/server/ai/orchestrator.ts';

function buildCalendarFallbackForTest(toolResults: Array<Record<string, unknown>>) {
  const failedResults = toolResults.filter((result) => Boolean(result.error));
  const failedToolNames = failedResults
    .map((result) => (typeof result.name === 'string' ? result.name : ''))
    .filter(Boolean);

  const calendarBookingFailed = failedToolNames.includes('createCalendarEvent')
    || toolResults.some((result) => {
      const name = typeof result.name === 'string' ? result.name : '';
      if (name !== 'createCalendarEvent') return false;
      const payload = result.result;
      if (payload && typeof payload === 'object') {
        const ok = (payload as { ok?: unknown }).ok;
        const eventId = (payload as { eventId?: unknown }).eventId;
        return ok !== true || typeof eventId !== 'string' || eventId.trim().length === 0;
      }
      return true;
    });

  if (calendarBookingFailed) {
    return 'не удалось записать, передаю администратору';
  }

  return null;
}

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
    assert.match(enabledAgentPrompt, /Подтверждать запись клиенту.*createCalendarEvent/i);
    assert.match(enabledAgentPrompt, /не удалось записать, передаю администратору/i);

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

test('sandbox blocks calendar write tools with explicit error and allows them only when flag is set', () => {
  const previousFlag = process.env.SANDBOX_ALLOW_CALENDAR_WRITE;

  try {
    delete process.env.SANDBOX_ALLOW_CALENDAR_WRITE;
    assert.equal(isSandboxToolAllowed('createCalendarEvent'), false);
    assert.equal(isSandboxToolAllowed('cancelCalendarEvent'), false);

    process.env.SANDBOX_ALLOW_CALENDAR_WRITE = 'true';
    assert.equal(isSandboxToolAllowed('createCalendarEvent'), true);
    assert.equal(isSandboxToolAllowed('cancelCalendarEvent'), true);
  } finally {
    if (previousFlag === undefined) delete process.env.SANDBOX_ALLOW_CALENDAR_WRITE; else process.env.SANDBOX_ALLOW_CALENDAR_WRITE = previousFlag;
  }
});

test('calendar booking failure fallback explicitly tells the user it could not book and passes to operator', () => {
  const fallback = buildCalendarFallbackForTest([
    { name: 'createCalendarEvent', result: null, error: 'sandbox: запись отключена' },
  ]);

  assert.equal(fallback, 'не удалось записать, передаю администратору');
});

test('tool loop allows up to five rounds and logs leftover tool calls without silently dropping them', () => {
  assert.equal(MAX_TOOL_ROUNDS, 5);

  const stateAtLimit = getToolLoopStateForTest({ iterations: 5, toolCalls: [{ name: 'checkCalendarAvailability', args: { date: '2026-10-10' } }] });
  assert.equal(stateAtLimit.shouldContinue, false);
  assert.equal(stateAtLimit.shouldLogLeftover, true);

  const stateBeforeLimit = getToolLoopStateForTest({ iterations: 2, toolCalls: [{ name: 'searchKnowledgeBase', args: { query: 'цены' } }] });
  assert.equal(stateBeforeLimit.shouldContinue, true);
  assert.equal(stateBeforeLimit.shouldLogLeftover, false);
});

test('empty final answer retries without tools after a blank KB search round and returns the model text to the client', async () => {
  const callGemini = mock.fn(async (_modelName: string, _systemPrompt: string, contents: Array<Record<string, unknown>>, tools: Array<Record<string, unknown>>) => {
    const lastMessage = String((contents.at(-1)?.parts?.[0] as { text?: string } | undefined)?.text ?? '');
    assert.equal(Array.isArray(tools), true, 'no-tools retry should call Gemini with no tool declarations');
    assert.equal(tools.length, 0, 'retry path must turn tool calling off');
    assert.match(lastMessage, /Ответь клиенту на его последнее сообщение на его языке/i, 'retry prompt should tell Gemini to answer the client in their language');

    return {
      text: 'Здравствуйте! Чтобы записать вас, уточните удобное время, услугу, имя и телефон.',
      provider: 'gemini',
      usage: {
        promptTokens: 12,
        completionTokens: 7,
        totalTokens: 19,
      },
      toolCalls: [],
      finishReason: 'STOP',
      payload: {
        parts: [{ text: 'Здравствуйте! Чтобы записать вас, уточните удобное время, услугу, имя и телефон.' }],
        finishReason: 'STOP',
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7 },
      },
    };
  });

  const result = await retryEmptyFinalAnswerWithoutTools({
    agentId: 'agent-1',
    conversationId: 'conversation-1',
    systemPrompt: 'Ты агент',
    conversationContents: [{ role: 'user', parts: [{ text: 'ия болады' }] }],
    userMessage: 'ия болады',
    callGeminiFn: callGemini as any,
  });

  assert.equal(result.finalAnswer, 'Здравствуйте! Чтобы записать вас, уточните удобное время, услугу, имя и телефон.');
  assert.equal(result.retryAttempted, true);
  assert.equal(callGemini.mock.callCount(), 1, 'no-tools retry should be invoked once');
});
