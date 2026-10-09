import { calendar } from '@googleapis/calendar';
import { getCalendarClientForAgent, CalendarNotConnectedError } from './client';
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

export async function checkAvailability({
  agentId,
  date,
  durationMinutes = 60,
  timezone = 'Asia/Almaty',
  workingHours,
  bufferMinutes = 0,
  minNoticeMinutes = 120,
  maxDaysAhead = 30,
  now = new Date(),
}: BookingAvailabilityInput) {
  return convertCalendarConnectionError(async () => {
    const auth = await getCalendarClientForAgent(agentId);
    const calendarApi = calendar({ version: 'v3', auth });
    const response = await calendarApi.freebusy.query({
      requestBody: {
        items: [{ id: 'primary' }],
        timeMin: new Date(`${date}T00:00:00`).toISOString(),
        timeMax: new Date(`${date}T23:59:59`).toISOString(),
      },
    });

    const items = (response as any)?.data?.calendars?.primary?.busy ?? [];
    const busy: BusyInterval[] = (items ?? []).map((item: { start?: string | null; end?: string | null }) => ({
      start: item.start ?? new Date().toISOString(),
      end: item.end ?? new Date().toISOString(),
    }));

    const defaultWorkingHours: WorkingHoursMap = {
      mon: [['09:00', '18:00']],
      tue: [['09:00', '18:00']],
      wed: [['09:00', '18:00']],
      thu: [['09:00', '18:00']],
      fri: [['09:00', '18:00']],
      sat: [],
      sun: [],
    };

    const slots = computeFreeSlots({
      date,
      timezone,
      workingHours: workingHours ?? defaultWorkingHours,
      busy,
      slotMinutes: durationMinutes,
      bufferMinutes,
      minNoticeMinutes,
      now,
      maxDaysAhead,
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
  clientName?: string;
  clientPhone?: string;
  notes?: string;
}) {
  return convertCalendarConnectionError(async () => {
    const auth = await getCalendarClientForAgent(agentId);
    const calendarApi = calendar({ version: 'v3', auth });

    const startDate = new Date(input.start);
    const endDate = input.end ? new Date(input.end) : new Date(startDate.getTime() + Number(input.slotMinutes ?? 60) * 60 * 1000);
    const descriptionParts = [
      input.description,
      input.notes,
      input.clientName ? `Клиент: ${input.clientName}` : undefined,
      input.clientPhone ? `Телефон: ${input.clientPhone}` : undefined,
    ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0);

    const event = await calendarApi.events.insert({
      calendarId: 'primary',
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
    await calendarApi.events.delete({ calendarId: 'primary', eventId } as any);
    return { ok: true };
  });
}

export async function cancelBookingForLead(agentId: string, leadId: string, reason: string = 'Отменено агентом') {
  return convertCalendarConnectionError(async () => {
    const auth = await getCalendarClientForAgent(agentId);
    const calendarApi = calendar({ version: 'v3', auth });
    const response = await calendarApi.events.list({
      calendarId: 'primary',
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

    await calendarApi.events.delete({ calendarId: 'primary', eventId: event.id } as any);
    return { ok: true, eventId: event.id, reason };
  });
}
