const UTC_OFFSETS: Record<string, string> = {
  'Asia/Almaty': '+05:00',
  'Asia/Qostanay': '+05:00',
  'Asia/Aqtobe': '+05:00',
  'Asia/Tashkent': '+05:00',
  'Europe/Moscow': '+03:00',
  UTC: '+00:00',
};

export const DEFAULT_TIMEZONE = 'Asia/Almaty';

export function getUtcOffset(timezone?: string): string {
  return UTC_OFFSETS[timezone ?? ''] ?? UTC_OFFSETS[DEFAULT_TIMEZONE];
}

/** Дата + время (HH:MM:SS) в указанном часовом поясе, как точный момент времени. */
export function zonedDate(date: string, time: string, timezone?: string): Date {
  return new Date(`${date}T${time}${getUtcOffset(timezone)}`);
}

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** День недели для календарной даты YYYY-MM-DD, не зависит от пояса сервера. */
export function weekdayKeyForDate(date: string): (typeof WEEKDAY_KEYS)[number] {
  return WEEKDAY_KEYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}
