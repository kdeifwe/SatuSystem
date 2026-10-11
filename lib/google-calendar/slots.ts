import { getUtcOffset, zonedDate, weekdayKeyForDate } from './timezone';

export type WorkingHoursMap = Record<string, Array<[string, string]>>;

export type BusyInterval = { start: string; end: string };

export type FreeSlot = {
  start: string;
  end: string;
};

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseWorkingHours(value: unknown): WorkingHoursMap | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const result: WorkingHoursMap = {};

  for (const day of DAY_KEYS) {
    const windows = source[day];
    if (windows === undefined) {
      result[day] = [];
      continue;
    }
    if (!Array.isArray(windows)) return undefined;

    const parsed: Array<[string, string]> = [];
    for (const window of windows) {
      if (!Array.isArray(window) || window.length !== 2) return undefined;
      const [from, to] = window;
      if (typeof from !== 'string' || typeof to !== 'string' || !CLOCK_RE.test(from) || !CLOCK_RE.test(to)) return undefined;
      parsed.push([from, to]);
    }
    result[day] = parsed;
  }

  return result;
}

function parseClock(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

function formatSlotTime(date: string, minutesFromMidnight: number, timezone?: string): string {
  const hours = Math.floor(minutesFromMidnight / 60);
  const mins = minutesFromMidnight % 60;
  const time = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
  return `${date}T${time}${getUtcOffset(timezone)}`;
}

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && endA > startB;
}

function clampSlotMinutes(slotMinutes: number): number {
  if (!Number.isFinite(slotMinutes) || slotMinutes <= 0) {
    return 60;
  }
  return Math.min(Math.max(Math.round(slotMinutes), 15), 240);
}

function startsAtExactBoundary(startMs: number, endMs: number, busyStartMs: number, busyEndMs: number): boolean {
  return busyStartMs <= startMs && startMs === busyEndMs;
}

export function computeFreeSlots({
  date,
  timezone,
  workingHours,
  busy,
  slotMinutes,
  stepMinutes = 30,
  bufferMinutes,
  minNoticeMinutes,
  now,
  maxDaysAhead,
}: {
  date: string;
  timezone: string;
  workingHours: WorkingHoursMap;
  busy: BusyInterval[];
  slotMinutes: number;
  stepMinutes?: number;
  bufferMinutes: number;
  minNoticeMinutes: number;
  now: Date;
  maxDaysAhead: number;
}): FreeSlot[] {
  const dayKey = weekdayKeyForDate(date);
  const windows = (workingHours?.[dayKey] ?? []) as Array<[string, string]>;
  if (!Array.isArray(windows) || windows.length === 0) {
    return [];
  }

  const dayStart = zonedDate(date, '00:00:00', timezone);
  if (dayStart.getTime() > now.getTime() + maxDaysAhead * 24 * 60 * 60 * 1000) {
    return [];
  }

  const normalizedSlotMinutes = clampSlotMinutes(slotMinutes);
  const normalizedStepMinutes = Number.isFinite(stepMinutes) && stepMinutes > 0 ? Math.max(Math.round(stepMinutes), 15) : 30;
  const result: FreeSlot[] = [];
  const busyDates = (busy ?? []).map((interval) => ({
    start: new Date(interval.start).getTime(),
    end: new Date(interval.end).getTime(),
  }));

  const normalizedWorkingHours = windows
    .map(([start, end]) => ({ start: parseClock(start), end: parseClock(end) }))
    .filter((window) => window.end > window.start);

  for (const window of normalizedWorkingHours) {
    let cursor = window.start;
    while (cursor + normalizedSlotMinutes <= window.end) {
      const slotStartMinutes = cursor;
      const slotEndMinutes = cursor + normalizedSlotMinutes;
      const slotStart = zonedDate(date, `${String(Math.floor(slotStartMinutes / 60)).padStart(2, '0')}:${String(slotStartMinutes % 60).padStart(2, '0')}:00`, timezone);
      const slotEnd = new Date(slotStart.getTime() + normalizedSlotMinutes * 60 * 1000);

      let blocked = false;
      for (const interval of busyDates) {
        const startBuffer = interval.start - bufferMinutes * 60 * 1000;
        const endBuffer = interval.end + bufferMinutes * 60 * 1000;

        if (startsAtExactBoundary(slotStart.getTime(), slotEnd.getTime(), interval.start, interval.end)) {
          continue;
        }

        if (slotStart.getTime() >= interval.end && slotStart.getTime() < endBuffer) {
          continue;
        }

        if (overlaps(slotStart.getTime(), slotEnd.getTime(), startBuffer, endBuffer)) {
          blocked = true;
          break;
        }
      }

      if (!blocked) {
        const noticeLimit = new Date(now.getTime() + minNoticeMinutes * 60 * 1000);
        if (slotStart.getTime() < noticeLimit.getTime()) {
          blocked = true;
        }
      }

      if (!blocked) {
        result.push({
          start: formatSlotTime(date, slotStartMinutes, timezone),
          end: formatSlotTime(date, slotEndMinutes, timezone),
        });
      }

      cursor += normalizedStepMinutes;
    }
  }

  return result.slice(0, 24);
}
