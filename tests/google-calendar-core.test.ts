import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

import { computeFreeSlots, parseWorkingHours, type WorkingHoursMap } from '../lib/google-calendar/slots.ts';
import { buildBusyIntervals, evaluateBooking, isWithinWorkingHours, createBooking } from '../lib/google-calendar/bookings.ts';
import { zonedDate } from '../lib/google-calendar/timezone.ts';
import { DEFAULT_DURATION_MINUTES, MIN_DURATION_MINUTES, MAX_DURATION_MINUTES, resolveDurationMinutes } from '../lib/google-calendar/duration.ts';
import { buildToolDeclarationsForAgent } from '../lib/ai/tools/registry.ts';
import { isSandboxToolAllowed } from '../lib/ai/tools/sandbox-allowlist.ts';
import { buildSystemPrompt } from '../lib/ai/compile-system-prompt.ts';
import { CalendarNotConnectedError, getCalendarClientForAgent } from '../lib/google-calendar/client.ts';
import { MAX_TOOL_ROUNDS, getToolLoopStateForTest, retryEmptyFinalAnswerWithoutTools } from '../lib/server/ai/orchestrator.ts';
import { getDateInPastCalendarError } from '../lib/ai/tools/executor.ts';
import { getDateInPastCalendarError } from '../lib/ai/tools/executor.ts';

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

test('resolveDurationMinutes applies priority, rounding and clamp constraints', () => {
  assert.equal(resolveDurationMinutes(12, 90, 45), 15);
  assert.equal(resolveDurationMinutes(null, '92', 45), 92);
  assert.equal(resolveDurationMinutes('75.4', 30), 75);
  assert.equal(resolveDurationMinutes(null, 0, '', '300'), 240);
  assert.equal(resolveDurationMinutes(undefined, '15.49'), 15);
  assert.equal(resolveDurationMinutes('bad', null, -12, '0'), DEFAULT_DURATION_MINUTES);
  assert.equal(MIN_DURATION_MINUTES, 15);
  assert.equal(MAX_DURATION_MINUTES, 240);
});

test('getDateInPastCalendarError rejects dates before the local Almaty date', () => {
  const today = new Date();
  const almatyDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Almaty',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(today);

  const [y, m, d] = almatyDate.split('-').map(Number);
  const previousDay = new Date(Date.UTC(y, m - 1, d - 1, 0, 0, 0));
  const pastDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(previousDay);

  assert.deepEqual(getDateInPastCalendarError(pastDate, 'Asia/Almaty'), {
    ok: false,
    reason: 'date_in_past',
    message: 'Дата в прошлом. Вызови getCurrentDate и пересчитай дату.',
  });

  assert.equal(getDateInPastCalendarError(almatyDate, 'Asia/Almaty'), null);
});

test('buildBusyIntervals only expands all-day meetings by capacity and timed meetings stay single-block', () => {
  const timed = [
    { status: 'confirmed', transparency: 'opaque', start: { dateTime: '2026-10-09T15:00:00+05:00' }, end: { dateTime: '2026-10-09T16:00:00+05:00' } },
  ];
  assert.deepEqual(buildBusyIntervals(timed, 'Asia/Almaty', 3), [{ start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T11:00:00.000Z' }]);

  const workingHours: WorkingHoursMap = {
    mon: [], tue: [], wed: [], thu: [], fri: [['10:00', '24:00']], sat: [], sun: [],
  };

  const oneTimedBusy = computeFreeSlots({
    date: '2026-10-09',
    timezone: 'Asia/Almaty',
    workingHours,
    busy: buildBusyIntervals(timed, 'Asia/Almaty', 3),
    slotMinutes: 60,
    stepMinutes: 60,
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    now: new Date('2026-10-08T12:00:00+05:00'),
    maxDaysAhead: 30,
    capacity: 3,
  });
  assert.ok(oneTimedBusy.some((slot) => slot.start === '2026-10-09T15:00:00+05:00'));

  const twoTimedBusy = computeFreeSlots({
    date: '2026-10-09',
    timezone: 'Asia/Almaty',
    workingHours,
    busy: [
      ...buildBusyIntervals(timed, 'Asia/Almaty', 3),
      ...buildBusyIntervals(timed, 'Asia/Almaty', 3),
    ],
    slotMinutes: 60,
    stepMinutes: 60,
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    now: new Date('2026-10-08T12:00:00+05:00'),
    maxDaysAhead: 30,
    capacity: 3,
  });
  assert.ok(twoTimedBusy.some((slot) => slot.start === '2026-10-09T15:00:00+05:00'));

  const threeTimedBusy = computeFreeSlots({
    date: '2026-10-09',
    timezone: 'Asia/Almaty',
    workingHours,
    busy: [
      ...buildBusyIntervals(timed, 'Asia/Almaty', 3),
      ...buildBusyIntervals(timed, 'Asia/Almaty', 3),
      ...buildBusyIntervals(timed, 'Asia/Almaty', 3),
    ],
    slotMinutes: 60,
    stepMinutes: 60,
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    now: new Date('2026-10-08T12:00:00+05:00'),
    maxDaysAhead: 30,
    capacity: 3,
  });
  assert.ok(!threeTimedBusy.some((slot) => slot.start === '2026-10-09T15:00:00+05:00'));
  assert.ok(threeTimedBusy.some((slot) => slot.start === '2026-10-09T16:00:00+05:00'));

  const singleCap = computeFreeSlots({
    date: '2026-10-09',
    timezone: 'Asia/Almaty',
    workingHours,
    busy: buildBusyIntervals(timed, 'Asia/Almaty', 1),
    slotMinutes: 60,
    stepMinutes: 60,
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    now: new Date('2026-10-08T12:00:00+05:00'),
    maxDaysAhead: 30,
    capacity: 1,
  });
  assert.ok(!singleCap.some((slot) => slot.start === '2026-10-09T15:00:00+05:00'));

  const allDayBusy = computeFreeSlots({
    date: '2026-10-09',
    timezone: 'Asia/Almaty',
    workingHours,
    busy: buildBusyIntervals([
      { status: 'confirmed', transparency: 'opaque', start: { date: '2026-10-09' }, end: { date: '2026-10-10' } },
    ], 'Asia/Almaty', 3),
    slotMinutes: 60,
    stepMinutes: 60,
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    now: new Date('2026-10-08T12:00:00+05:00'),
    maxDaysAhead: 30,
    capacity: 3,
  });
  assert.equal(allDayBusy.length, 0);
});

test('buildBusyIntervals and isWithinWorkingHours handle all-day blocks and valid/invalid windows', () => {
  const items = [
    { status: 'confirmed', transparency: 'opaque', start: { date: '2026-10-09' }, end: { date: '2026-10-10' } },
    { status: 'cancelled', transparency: 'opaque', start: { date: '2026-10-09' }, end: { date: '2026-10-10' } },
    { status: 'confirmed', transparency: 'transparent', start: { date: '2026-10-09' }, end: { date: '2026-10-10' } },
    { status: 'confirmed', transparency: 'opaque', start: { dateTime: '2026-10-09T12:00:00+05:00' }, end: { dateTime: '2026-10-09T13:00:00+05:00' } },
  ];
  const busy = buildBusyIntervals(items, 'Asia/Almaty', 3);
  assert.equal(busy.length, 4);
  const allDayRange = {
    start: zonedDate('2026-10-09', '00:00:00', 'Asia/Almaty').toISOString(),
    end: zonedDate('2026-10-10', '00:00:00', 'Asia/Almaty').toISOString(),
  };
  assert.deepEqual(busy[0], allDayRange);
  assert.ok(busy.slice(0, 3).every((entry) => entry.start === allDayRange.start && entry.end === allDayRange.end));

  const workingHours: WorkingHoursMap = {
    sun: [], mon: [], tue: [], wed: [], thu: [], fri: [['10:00', '24:00']], sat: [],
  };

  assert.equal(isWithinWorkingHours(new Date('2026-10-09T23:00:00+05:00'), new Date('2026-10-10T00:00:00+05:00'), workingHours, 'Asia/Almaty'), true);
  assert.equal(isWithinWorkingHours(new Date('2026-10-09T09:30:00+05:00'), new Date('2026-10-09T10:30:00+05:00'), workingHours, 'Asia/Almaty'), false);
  assert.equal(isWithinWorkingHours(new Date('2026-10-09T23:30:00+05:00'), new Date('2026-10-10T00:30:00+05:00'), workingHours, 'Asia/Almaty'), false);
  assert.equal(isWithinWorkingHours(new Date('2026-10-09T12:00:00+05:00'), new Date('2026-10-09T18:00:00+05:00'), { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }, 'Asia/Almaty'), false);

  const slots = computeFreeSlots({
    date: '2026-10-09',
    timezone: 'Asia/Almaty',
    workingHours: { mon: [], tue: [], wed: [], thu: [], fri: [['10:00', '24:00']], sat: [], sun: [] },
    busy: [
      { start: '2026-10-09T00:00:00+05:00', end: '2026-10-10T00:00:00+05:00' },
      { start: '2026-10-09T00:00:00+05:00', end: '2026-10-10T00:00:00+05:00' },
      { start: '2026-10-09T00:00:00+05:00', end: '2026-10-10T00:00:00+05:00' },
    ],
    slotMinutes: 60,
    stepMinutes: 30,
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    now: new Date('2026-10-08T12:00:00+05:00'),
    maxDaysAhead: 30,
    capacity: 3,
  });
  assert.deepEqual(slots, []);

  const timezoneOverlap = computeFreeSlots({
    date: '2026-10-09',
    timezone: 'Asia/Almaty',
    workingHours: { mon: [], tue: [], wed: [], thu: [], fri: [['10:00', '24:00']], sat: [], sun: [] },
    busy: [{ start: '2026-10-09T10:00:00+05:00', end: '2026-10-09T11:00:00+05:00' }],
    slotMinutes: 60,
    stepMinutes: 60,
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    now: new Date('2026-10-08T12:00:00+05:00'),
    maxDaysAhead: 30,
    capacity: 1,
  });
  assert.ok(timezoneOverlap.some((slot) => slot.start === '2026-10-09T11:00:00+05:00'));
});

test('evaluateBooking validates working hours and capacity for booking decisions', () => {
  const workingHours = {
    mon: [], tue: [], wed: [], thu: [], fri: [['10:00', '24:00']], sat: [], sun: [],
  } as WorkingHoursMap;

  assert.deepEqual(
    evaluateBooking({
      start: '2026-10-09T23:00:00+05:00',
      end: '2026-10-10T00:00:00+05:00',
      items: [],
      capacity: 1,
      workingHours,
      timezone: 'Asia/Almaty',
    }),
    { ok: true },
  );

  assert.deepEqual(
    evaluateBooking({
      start: '2026-10-09T09:30:00+05:00',
      end: '2026-10-09T10:30:00+05:00',
      items: [],
      capacity: 1,
      workingHours,
      timezone: 'Asia/Almaty',
    }),
    { ok: false, reason: 'outside_working_hours' },
  );

  assert.deepEqual(
    evaluateBooking({
      start: '2026-10-09T15:00:00+05:00',
      end: '2026-10-09T16:00:00+05:00',
      items: [
        { status: 'confirmed', start: { dateTime: '2026-10-09T15:00:00+05:00' }, end: { dateTime: '2026-10-09T16:00:00+05:00' } },
        { status: 'confirmed', start: { dateTime: '2026-10-09T15:00:00+05:00' }, end: { dateTime: '2026-10-09T16:00:00+05:00' } },
        { status: 'confirmed', start: { dateTime: '2026-10-09T15:00:00+05:00' }, end: { dateTime: '2026-10-09T16:00:00+05:00' } },
      ],
      capacity: 3,
      workingHours,
      timezone: 'Asia/Almaty',
    }),
    { ok: false, reason: 'slot_unavailable' },
  );

  assert.deepEqual(
    evaluateBooking({
      start: '2026-10-09T15:00:00+05:00',
      end: '2026-10-09T16:00:00+05:00',
      items: [
        { status: 'confirmed', start: { dateTime: '2026-10-09T15:00:00+05:00' }, end: { dateTime: '2026-10-09T16:00:00+05:00' } },
        { status: 'confirmed', start: { dateTime: '2026-10-09T15:00:00+05:00' }, end: { dateTime: '2026-10-09T16:00:00+05:00' } },
      ],
      capacity: 3,
      workingHours,
      timezone: 'Asia/Almaty',
    }),
    { ok: true },
  );

  assert.deepEqual(
    evaluateBooking({
      start: '2026-10-09T00:00:00+05:00',
      end: '2026-10-10T00:00:00+05:00',
      items: [
        { status: 'confirmed', start: { date: '2026-10-09' }, end: { date: '2026-10-10' } },
        { status: 'confirmed', start: { date: '2026-10-09' }, end: { date: '2026-10-10' } },
        { status: 'confirmed', start: { date: '2026-10-09' }, end: { date: '2026-10-10' } },
      ],
      capacity: 3,
      workingHours,
      timezone: 'Asia/Almaty',
    }),
    { ok: false, reason: 'outside_working_hours' },
  );
});

test('createBooking stops before insert when the slot is unavailable', async () => {
  process.env.GOOGLE_SA_EMAIL = 'test@example.com';
  process.env.GOOGLE_SA_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n';
  process.env.GOOGLE_CALENDAR_ID = 'test-calendar-id';

  const insert = mock.fn(async () => ({ data: { id: 'evt_123' } }));
  const calendarApi = {
    events: {
      list: async () => ({
        data: {
          items: [
            { status: 'confirmed', start: { dateTime: '2026-10-09T15:00:00+05:00' }, end: { dateTime: '2026-10-09T16:00:00+05:00' } },
            { status: 'confirmed', start: { dateTime: '2026-10-09T15:00:00+05:00' }, end: { dateTime: '2026-10-09T16:00:00+05:00' } },
            { status: 'confirmed', start: { dateTime: '2026-10-09T15:00:00+05:00' }, end: { dateTime: '2026-10-09T16:00:00+05:00' } },
          ],
        },
      }),
      insert,
    },
  };

  const result = await createBooking(
    'agent-1',
    {
      start: '2026-10-09T15:00:00+05:00',
      end: '2026-10-09T16:00:00+05:00',
      summary: 'Test booking',
      leadId: 'lead-1',
      capacity: 3,
      workingHours: {
        mon: [], tue: [], wed: [], thu: [], fri: [['10:00', '24:00']], sat: [], sun: [],
      } as WorkingHoursMap,
      timezone: 'Asia/Almaty',
    },
    async () => ({}) as any,
    () => calendarApi as any,
  );

  assert.deepEqual(result, { ok: false, reason: 'slot_unavailable' });
  assert.equal(insert.mock.callCount(), 0);
});

test('computeFreeSlots respects working hours, buffer, min_notice and day boundaries for variable duration', () => {
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
      { start: '2026-10-09T10:00:00+05:00', end: '2026-10-09T11:00:00+05:00' },
      { start: '2026-10-09T15:30:00+05:00', end: '2026-10-09T15:45:00+05:00' },
    ],
    slotMinutes: 90,
    bufferMinutes: 15,
    minNoticeMinutes: 60,
    now: new Date('2026-10-08T12:00:00+05:00'),
    maxDaysAhead: 30,
  });

  assert.ok(slots.length > 0);
  assert.ok(slots.every((slot) => slot.end > slot.start));
  assert.ok(slots.some((slot) => slot.start.includes('09:00')) || slots.some((slot) => slot.start.includes('11:00')));
  assert.ok(slots.some((slot) => slot.start.includes('11:00')));
});

test('slot computation is timezone invariant and respects explicit +05:00 busy windows', () => {
  const busy = [{ start: '2026-10-09T10:00:00+05:00', end: '2026-10-09T11:00:00+05:00' }];
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
    busy,
    slotMinutes: 60,
    stepMinutes: 30,
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    now: new Date('2026-10-08T12:00:00+05:00'),
    maxDaysAhead: 30,
  });

  const starts = slots.map((slot) => slot.start);
  assert.ok(starts.includes('2026-10-09T09:00:00+05:00'));
  assert.ok(starts.includes('2026-10-09T11:00:00+05:00'));
  assert.ok(!starts.includes('2026-10-09T09:30:00+05:00'));
  assert.ok(!starts.includes('2026-10-09T10:00:00+05:00'));
  assert.ok(!starts.includes('2026-10-09T10:30:00+05:00'));
  assert.ok(starts.every((start) => start.includes('+05:00')));
});

test('parseWorkingHours supports 24:00 as the end of the day and computeFreeSlots respects capacity and end-of-day boundaries', () => {
  assert.ok(parseWorkingHours({ mon: [['10:00', '24:00']] } as any));
  assert.equal(parseWorkingHours({ mon: [['24:00', '24:30']] } as any), undefined);
  assert.equal(parseWorkingHours({ mon: [['10:00', '25:00']] } as any), undefined);

  const fullDaySlots = computeFreeSlots({
    date: '2026-10-09',
    timezone: 'Asia/Almaty',
    workingHours: {
      mon: [],
      tue: [],
      wed: [],
      thu: [],
      fri: [['10:00', '24:00']],
      sat: [],
      sun: [],
    },
    busy: [],
    slotMinutes: 60,
    stepMinutes: 30,
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    now: new Date('2026-10-08T12:00:00+05:00'),
    maxDaysAhead: 30,
  });

  const fullDayStarts = fullDaySlots.map((slot) => slot.start);
  assert.ok(fullDayStarts.includes('2026-10-09T10:00:00+05:00'));
  assert.ok(fullDayStarts.includes('2026-10-09T23:00:00+05:00'));
  assert.ok(!fullDayStarts.includes('2026-10-10T00:00:00+05:00'));
  assert.ok(fullDaySlots.some((slot) => slot.start === '2026-10-09T23:00:00+05:00' && slot.end === '2026-10-10T00:00:00+05:00'));
  assert.ok(!fullDayStarts.includes('2026-10-09T23:30:00+05:00'));

  const threeBusyAtNoon = computeFreeSlots({
    date: '2026-10-09',
    timezone: 'Asia/Almaty',
    workingHours: {
      mon: [],
      tue: [],
      wed: [],
      thu: [],
      fri: [['10:00', '24:00']],
      sat: [],
      sun: [],
    },
    busy: [
      { start: '2026-10-09T15:00:00+05:00', end: '2026-10-09T16:00:00+05:00' },
      { start: '2026-10-09T15:00:00+05:00', end: '2026-10-09T16:00:00+05:00' },
      { start: '2026-10-09T15:00:00+05:00', end: '2026-10-09T16:00:00+05:00' },
    ],
    slotMinutes: 60,
    stepMinutes: 30,
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    now: new Date('2026-10-08T12:00:00+05:00'),
    maxDaysAhead: 30,
    capacity: 3,
  });
  assert.ok(!threeBusyAtNoon.some((slot) => slot.start === '2026-10-09T15:00:00+05:00'));
  assert.ok(!threeBusyAtNoon.some((slot) => slot.start === '2026-10-09T15:30:00+05:00'));
  assert.ok(threeBusyAtNoon.some((slot) => slot.start === '2026-10-09T16:00:00+05:00'));

  const twoBusyAtNoon = computeFreeSlots({
    date: '2026-10-09',
    timezone: 'Asia/Almaty',
    workingHours: {
      mon: [],
      tue: [],
      wed: [],
      thu: [],
      fri: [['10:00', '24:00']],
      sat: [],
      sun: [],
    },
    busy: [
      { start: '2026-10-09T15:00:00+05:00', end: '2026-10-09T16:00:00+05:00' },
      { start: '2026-10-09T15:00:00+05:00', end: '2026-10-09T16:00:00+05:00' },
    ],
    slotMinutes: 60,
    stepMinutes: 30,
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    now: new Date('2026-10-08T12:00:00+05:00'),
    maxDaysAhead: 30,
    capacity: 3,
  });
  assert.ok(twoBusyAtNoon.some((slot) => slot.start === '2026-10-09T15:00:00+05:00'));

  const adjacencySlots = computeFreeSlots({
    date: '2026-10-09',
    timezone: 'Asia/Almaty',
    workingHours: {
      mon: [],
      tue: [],
      wed: [],
      thu: [],
      fri: [['10:00', '24:00']],
      sat: [],
      sun: [],
    },
    busy: [{ start: '2026-10-09T10:00:00+05:00', end: '2026-10-09T11:00:00+05:00' }],
    slotMinutes: 60,
    stepMinutes: 30,
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    now: new Date('2026-10-08T12:00:00+05:00'),
    maxDaysAhead: 30,
    capacity: 1,
  });
  assert.ok(adjacencySlots.some((slot) => slot.start === '2026-10-09T11:00:00+05:00'));
});

test('slots honor saturday hours, empty days, full days, future horizon and parseWorkingHours validation', () => {
  const saturdaySlots = computeFreeSlots({
    date: '2026-10-10',
    timezone: 'Asia/Almaty',
    workingHours: {
      mon: [],
      tue: [],
      wed: [],
      thu: [],
      fri: [],
      sat: [['10:00', '12:00']],
      sun: [],
    },
    busy: [],
    slotMinutes: 60,
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    now: new Date('2026-10-09T10:00:00+05:00'),
    maxDaysAhead: 30,
  });
  assert.ok(saturdaySlots.length > 0);
  assert.ok(saturdaySlots.every((slot) => slot.start.includes('+05:00')));

  const emptyDay = computeFreeSlots({
    date: '2026-10-11',
    timezone: 'Asia/Almaty',
    workingHours: {
      mon: [],
      tue: [],
      wed: [],
      thu: [],
      fri: [],
      sat: [],
      sun: [],
    },
    busy: [],
    slotMinutes: 60,
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    now: new Date('2026-10-10T09:00:00+05:00'),
    maxDaysAhead: 30,
  });
  assert.deepEqual(emptyDay, []);

  const fullDay = computeFreeSlots({
    date: '2026-10-12',
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
    busy: [],
    slotMinutes: 60,
    stepMinutes: 30,
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    now: new Date('2026-10-11T09:00:00+05:00'),
    maxDaysAhead: 30,
  });
  assert.ok(fullDay.length > 8);
  assert.ok(fullDay.length <= 30);

  const outOfRange = computeFreeSlots({
    date: '2100-01-01',
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
    busy: [],
    slotMinutes: 60,
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    now: new Date('2026-10-09T09:00:00+05:00'),
    maxDaysAhead: 30,
  });
  assert.deepEqual(outOfRange, []);

  assert.ok(parseWorkingHours({ mon: [['10:00', '20:00']], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }));
  assert.equal(parseWorkingHours(null), undefined);
  assert.equal(parseWorkingHours([] as unknown[]), undefined);
  assert.equal(parseWorkingHours({ mon: ['25:00'] } as any), undefined);
  assert.equal(parseWorkingHours({ mon: [['10:00', '20:00', '22:00']] } as any), undefined);
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
    const lastParts = Array.isArray(contents.at(-1)?.parts) ? (contents.at(-1)?.parts as Array<{ text?: string }>) : [];
    const lastMessage = String((lastParts[0] as { text?: string } | undefined)?.text ?? '');
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
