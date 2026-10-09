import { JWT } from 'google-auth-library';

export class CalendarNotConnectedError extends Error {
  constructor(message = 'Google Calendar не подключён') {
    super(message);
    this.name = 'CalendarNotConnectedError';
  }
}

function getServiceAccountConfig() {
  const email = process.env.GOOGLE_SA_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_SA_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  const calendarId = process.env.GOOGLE_CALENDAR_ID?.trim();

  if (!email || !privateKey || !calendarId) {
    throw new CalendarNotConnectedError();
  }

  return { email, privateKey, calendarId };
}

export function getGoogleCalendarId(): string {
  return getServiceAccountConfig().calendarId;
}

export async function getCalendarClientForAgent(_agentId: string): Promise<JWT> {
  const { email, privateKey } = getServiceAccountConfig();

  return new JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
}
