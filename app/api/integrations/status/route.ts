import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: NextRequest) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({}, { status: 401 });

  const agentId = req.nextUrl.searchParams.get('agentId');

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: channels } = await admin
    .from('channels')
    .select('type, credentials, is_active, connection_status')
    .eq('is_active', true);

  const { data: googleCalendarConnection } = await admin
    .from('calendar_connections')
    .select('*')
    .eq('agent_id', agentId)
    .maybeSingle();

  const result: Record<string, any> = {
    telegram_bot: null,
    telegram_userbot: null,
    whatsapp: null,
    instagram: null,
    google_calendar: null,
  };

  for (const ch of channels ?? []) {
    const credentials = ch.credentials as Record<string, unknown> | null;
    const matchesAgent = !credentials?.agent_id || credentials.agent_id === agentId;
    if (!matchesAgent) continue;

    if (ch.type === 'telegram' && typeof credentials?.bot_username === 'string') {
      result.telegram_bot = { connected: true, bot_username: credentials.bot_username };
    }
    if (ch.type === 'telegram_userbot') {
      result.telegram_userbot = { connected: true, phone: credentials?.phone };
    }
    if (ch.type === 'whatsapp') {
      result.whatsapp = { connected: true };
    }
    if (ch.type === 'instagram') {
      result.instagram = {
        connected: Boolean(ch.is_active && credentials?.ig_user_id),
        status: ch.connection_status ?? (ch.is_active ? 'connected' : 'disconnected'),
        username: typeof credentials?.username === 'string' ? credentials.username : null,
        token_expires_at: credentials?.expires_at ?? null,
        message: typeof credentials?.last_error === 'string' ? credentials.last_error : null,
      };
    }
  }

  if (googleCalendarConnection) {
    result.google_calendar = {
      connected: googleCalendarConnection.status === 'connected',
      status: googleCalendarConnection.status ?? 'disconnected',
      google_email: googleCalendarConnection.google_email ?? null,
      needs_reauth: googleCalendarConnection.status === 'needs_reauth',
    };
  }

  return NextResponse.json(result);
}
