import { createServiceClient } from '@/lib/supabase/service';

export interface WorkHoursWindow {
  startHour: number;
  endHour: number;
}

const DEFAULT_WORK_HOURS: WorkHoursWindow = { startHour: 9, endHour: 18 };

export function isWithinWorkHours(date: Date, timezone: string, window: WorkHoursWindow = DEFAULT_WORK_HOURS): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'Asia/Almaty',
    hour: '2-digit',
    hour12: false,
  }).format(date));
  return hour >= window.startHour && hour < window.endHour;
}

export function nextWorkHoursDate(date: Date, timezone: string, window: WorkHoursWindow = DEFAULT_WORK_HOURS): Date {
  if (isWithinWorkHours(date, timezone, window)) return date;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'Asia/Almaty',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  const candidate = new Date(Date.UTC(year, month - 1, day, window.startHour));
  if (candidate <= date) candidate.setUTCDate(candidate.getUTCDate() + 1);
  return candidate;
}

export async function getOrganizationTimezone(orgId: string, supabase = createServiceClient()): Promise<string> {
  const { data } = await supabase.from('organizations').select('timezone').eq('id', orgId).maybeSingle();
  return data?.timezone || 'Asia/Almaty';
}
