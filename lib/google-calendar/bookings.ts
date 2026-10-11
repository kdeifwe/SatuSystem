import { calendar } from '@googleapis/calendar';
import { getCalendarClientForAgent, CalendarNotConnectedError, getGoogleCalendarId } from './client';
import { resolveDurationMinutes } from './duration';
import { zonedDate } from './timezone';
import { computeFreeSlots, type BusyInterval, type WorkingHoursMap } from './slots';

export type BookingAvailabilityInput = {
  agentId: string;
  date: string;
  durationMinutes?: number;
  timezone?: string;
  workingHours?: WorkingHoursMap;
  bufferMinutes?: number;
  minNoticeMinutes?: number;
  maxDaysAhead?: number;
  now?: Date;
  capacity?: number;
};

async function convertCalendarConnectionError<T>(operation: () => Promise<T>): Promise<T | { ok: false; reason: 'calendar_not_connected' }> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CalendarNotConnectedError) {
      return { ok: false, reason: 'calendar_not_connected' };
    }
    throw error;
  }
}

function normalizeBookingCapacity(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  const intValue = Math.trunc(parsed);
  return intValue >= 1 ? intValue : 1;
}

function isEventBusy(item: { status?: string | null; transparency?: string | null; start?: { date?: string | null; dateTime?: string | null } | null; end?: { date?: string | null; dateTime?: string | null } | null }): boolean {
  if (item.status === 'cancelled' || item.transparency === 'transparent') return false;
  if (!item.start) return false;
  const start = item.start.dateTime ?? item.start.date;
  const end = item.end?.dateTime ?? item.end?.date;
  return Boolean(start && end);
}

function overlapsWindow(start: Date, end: Date, busyStart: string | null | undefined, busyEnd: string | null | undefined): boolean {
  if (!busyStart || !busyEnd) return false;
  const busyStartMs = new Date(busyStart).getTime();
  const busyEndMs = new Date(busyEnd).getTime();
  return start.getTime() < busyEndMs && end.getTime() > busyStartMs;
}

export async function checkAvailability({
  agentId,
  date,
  durationMinutes,
  timezone = 'Asia/Almaty',
  workingHours,
  bufferMinutes = 0,
  minNoticeMinutes = 120,
  maxDaysAhead = 30,
  now = new Date(),
  capacity = 1,
}: BookingAvailabilityInput) {
  return convertCalendarConnectionError(async () => {
    const auth = await getCalendarClientForAgent(agentId);
    const calendarApi = calendar({ version: 'v3', auth });
    const calendarId = getGoogleCalendarId();
    const response = await calendarApi.events.list({
      calendarId,
      timeMin: zonedDate(date, '00:00:00', timezone).toISOString(),
      timeMax: zonedDate(date, '23:59:59', timezone).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });

    const items = (response as any)?.data?.items ?? [];
    const busy: BusyInterval[] = [];
    for (const item of items) {
      if (!isEventBusy(item)) continue;
      const startDate = item.start?.date;
      const endDate = item.end?.date;
      if (startDate && !item.start?.dateTime) {
        const fullDayStart = zonedDate(startDate, '00:00:00', timezone).toISOString();
        const fullDayEnd = endDate ? zonedDate(endDate, '00:00:00', timezone).toISOString() : zonedDate(startDate, '23:59:59', timezone).toISOString();
        busy.push({ start: fullDayStart, end: fullDayEnd });
        continue;
      }
      const eventStart = item.start?.dateTime ?? item.start?.date;
      const eventEnd = item.end?.dateTime ?? item.end?.date;
      if (!eventStart || !eventEnd) continue;
      busy.push({ start: new Date(eventStart).toISOString(), end: new Date(eventEnd).toISOString() });
    }

    const defaultWorkingHours: WorkingHoursMap = {
      mon: [['09:00', '18:00']],
      tue: [['09:00', '18:00']],
      wed: [['09:00', '18:00']],
      thu: [['09:00', '18:00']],
      fri: [['09:00', '18:00']],
      sat: [],
      sun: [],
    };

    const slotMinutes = resolveDurationMinutes(durationMinutes, 60);
    const slots = computeFreeSlots({
      date,
      timezone,
      workingHours: workingHours ?? defaultWorkingHours,
      busy,
      slotMinutes,
      bufferMinutes,
      minNoticeMinutes,
      now,
      maxDaysAhead,
      capacity,
    });

    return { slots };
  });
}

export async function createBooking(agentId: string, input: {
  start: string;
  end?: string;
  summary: string;
  description?: string;
  leadId: string;
  agentIdValue?: string;
  slotMinutes?: number;
  capacity?: number;
  clientName?: string;
  clientPhone?: string;
  notes?: string;
}) {
  return convertCalendarConnectionError(async () => {
    const auth = await getCalendarClientForAgent(agentId);
    const calendarApi = calendar({ version: 'v3', auth });
    const calendarId = getGoogleCalendarId();

    const startDate = new Date(input.start);
    const slotMinutes = resolveDurationMinutes(input.slotMinutes, 60);
    const endDate = input.end ? new Date(input.end) : new Date(startDate.getTime() + slotMinutes * 60 * 1000);
    const capacity = normalizeBookingCapacity(input.capacity ?? 1);
    const response = await calendarApi.events.list({
      calendarId,
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });

    const busyCount = (response as any)?.data?.items?.filter((item: any) => {
      if (item.status === 'cancelled' || item.transparency === 'transparent') return false;
      const eventStart = item.start?.dateTime ?? item.start?.date;
      const eventEnd = item.end?.dateTime ?? item.end?.date;
      if (!eventStart || !eventEnd) return false;
      return overlapsWindow(startDate, endDate, eventStart, eventEnd);
    }).length ?? 0;

    if (busyCount >= capacity) {
      return { ok: false, reason: 'slot_unavailable' };
    }

    const descriptionParts = [
      input.description,
      input.notes,
      input.clientName ? `Клиент: ${input.clientName}` : undefined,
      input.clientPhone ? `Телефон: ${input.clientPhone}` : undefined,
    ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0);

    const event = await calendarApi.events.insert({
      calendarId,
      requestBody: {
        summary: input.summary,
        description: descriptionParts.join('\n'),
        start: { dateTime: startDate.toISOString() },
        end: { dateTime: endDate.toISOString() },
        sendUpdates: 'none',
        extendedProperties: {
          private: {
            lead_id: input.leadId,
            agent_id: input.agentIdValue ?? agentId,
            source: 'satusystem',
            client_name: input.clientName ?? '',
            client_phone: input.clientPhone ?? '',
            notes: input.notes ?? '',
          },
        },
      },
    } as any);

    return { ok: true, eventId: event.data?.id ?? null, event };
  });
}

export async function cancelBooking(agentId: string, eventId: string) {
  return convertCalendarConnectionError(async () => {
    const auth = await getCalendarClientForAgent(agentId);
    const calendarApi = calendar({ version: 'v3', auth });
    await calendarApi.events.delete({ calendarId: getGoogleCalendarId(), eventId } as any);
    return { ok: true };
  });
}

export async function cancelBookingForLead(agentId: string, leadId: string, reason: string = 'Отменено агентом') {
  return convertCalendarConnectionError(async () => {
    const auth = await getCalendarClientForAgent(agentId);
    const calendarApi = calendar({ version: 'v3', auth });
    const response = await calendarApi.events.list({
      calendarId: getGoogleCalendarId(),
      privateExtendedProperty: [`lead_id=${leadId}`] as string[],
      maxResults: 20,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const items = (response as any)?.data?.items ?? [];
    const event = items.find((item: { id?: string | null; extendedProperties?: { private?: Record<string, string | null> } | null }) => item.id && item.extendedProperties?.private?.lead_id === leadId) ?? items[0];
    if (!event?.id) {
      throw new Error(`Не найдено событий Google Calendar для lead_id=${leadId}`);
    }

    await calendarApi.events.delete({ calendarId: getGoogleCalendarId(), eventId: event.id } as any);
    return { ok: true, eventId: event.id, reason };
  });
}
