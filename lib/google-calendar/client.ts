import { createAdminClient } from '@/lib/supabase/admin';
import { decryptSecret } from '@/lib/server/crypto';
import { OAuth2Client } from 'google-auth-library';

export class CalendarNotConnectedError extends Error {
  constructor(message = 'Google Calendar не подключён') {
    super(message);
    this.name = 'CalendarNotConnectedError';
  }
}

export type CalendarConnectionRow = {
  id: string;
  agent_id: string;
  org_id: string;
  google_email?: string | null;
  status?: string | null;
  refresh_token_encrypted: string;
  scopes?: string[] | null;
  last_error?: string | null;
};

export async function getCalendarConnection(agentId: string): Promise<CalendarConnectionRow> {
  const admin = createAdminClient();
  const { data, error } = await admin.from('calendar_connections').select('*').eq('agent_id', agentId).maybeSingle();

  if (error || !data) {
    throw new CalendarNotConnectedError();
  }

  if (data.status === 'connected') {
    return data as CalendarConnectionRow;
  }

  if (data.status === 'needs_reauth') {
    throw new CalendarNotConnectedError('Google Calendar требует повторного подключения');
  }

  throw new CalendarNotConnectedError('Google Calendar отключён');
}

export async function getCalendarClientForAgent(agentId: string): Promise<OAuth2Client> {
  const connection = await getCalendarConnection(agentId);
  const refreshToken = decryptSecret(connection.refresh_token_encrypted);

  const auth = new OAuth2Client({
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/google-calendar/oauth/callback`,
  });

  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}
