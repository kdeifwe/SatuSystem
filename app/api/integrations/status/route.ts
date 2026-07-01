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
    .select('type, credentials, is_active')
    .eq('is_active', true);

  const result: Record<string, any> = {
    telegram_bot: null,
    telegram_userbot: null,
    whatsapp: null,
    instagram: null,
  };

  for (const ch of channels ?? []) {
    const credentials = ch.credentials as Record<string, unknown> | null;
    if (!credentials?.agent_id || credentials.agent_id === agentId) {
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
        result.instagram = { connected: true };
      }
    }
  }

  return NextResponse.json(result);
}
