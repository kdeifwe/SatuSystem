export type WorkingHoursMap = Record<string, Array<[string, string]>>;

export type BusyInterval = { start: string; end: string };

export type FreeSlot = {
  start: string;
  end: string;
};

function parseClock(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

function formatLocalMinute(date: string, minutesFromMidnight: number): string {
  const hours = Math.floor(minutesFromMidnight / 60);
  const mins = minutesFromMidnight % 60;
  return `${date}T${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function weekdayKey(dateString: string): keyof WorkingHoursMap {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(`${dateString}T00:00:00`);
  const names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return names[date.getDay()] as keyof WorkingHoursMap;
}

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && endA > startB;
}

export function computeFreeSlots({
  date,
  timezone,
  workingHours,
  busy,
  slotMinutes,
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
  bufferMinutes: number;
  minNoticeMinutes: number;
  now: Date;
  maxDaysAhead: number;
}): FreeSlot[] {
  const dayKey = weekdayKey(date);
  const windows = (workingHours?.[dayKey] ?? []) as Array<[string, string]>;
  if (!Array.isArray(windows) || windows.length === 0) {
    return [];
  }

  const dayStart = new Date(`${date}T00:00:00`);
  const horizonEnd = new Date(dayStart.getTime() + maxDaysAhead * 24 * 60 * 60 * 1000);
  if (now > horizonEnd) {
    return [];
  }

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
    while (cursor + slotMinutes <= window.end) {
      const slotStartMinutes = cursor;
      const slotEndMinutes = cursor + slotMinutes;
      const slotStart = new Date(`${date}T${String(Math.floor(slotStartMinutes / 60)).padStart(2, '0')}:${String(slotStartMinutes % 60).padStart(2, '0')}:00`);
      const slotEnd = new Date(slotStart.getTime() + slotMinutes * 60 * 1000);

      let blocked = false;
      for (const interval of busyDates) {
        const startBuffer = interval.start - bufferMinutes * 60 * 1000;
        const endBuffer = interval.end + bufferMinutes * 60 * 1000;

        if (slotStart.getTime() >= interval.end && slotStart.getTime() < endBuffer) {
          // Allow a slot to begin exactly at the end of a busy block. The buffered gap is for the end of the busy event,
          // not for the exact next appointment boundary.
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
          start: formatLocalMinute(date, slotStartMinutes),
          end: formatLocalMinute(date, slotEndMinutes),
        });
      }

      cursor += 15;
    }
  }

  return result.slice(0, 8);
}
