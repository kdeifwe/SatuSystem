import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = admin();
  const { data: channels } = await client
    .from('channels')
    .select('id, org_id, credentials')
    .eq('type', 'instagram')
    .eq('is_active', true);

  let updated = 0;

  for (const channel of channels ?? []) {
    const credentials = (channel.credentials as Record<string, unknown> | null) ?? {};
    const accessToken = typeof credentials.access_token === 'string' ? credentials.access_token : '';
    const expiresAt = credentials.expires_at ? new Date(String(credentials.expires_at)).getTime() : 0;
    const soon = Date.now() + 10 * 24 * 60 * 60 * 1000;

    if (!accessToken || expiresAt > soon) continue;

    try {
      const response = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(accessToken)}`);
      const data = await response.json();
      const nextToken = data?.access_token;
      if (!response.ok || !nextToken) continue;

      const nextExpiresAt = data?.expires_in ? Date.now() + Number(data.expires_in) * 1000 : null;
      await client.from('channels').update({
        credentials: { ...credentials, access_token: nextToken, expires_at: nextExpiresAt }
      }).eq('id', channel.id);
      updated += 1;
    } catch (error) {
      console.error('[instagram cron refresh] failed', channel.id, error);
    }
  }

  return NextResponse.json({ updated });
}
