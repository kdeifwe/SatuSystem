import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseServer } from '@/lib/supabase/server';
import { buildInstagramOAuthState } from '@/lib/server/instagram-oauth';

export async function GET(req: NextRequest) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const agentId = req.nextUrl.searchParams.get('agentId');
  if (!agentId) return NextResponse.json({ error: 'agentId обязателен' }, { status: 400 });

  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!appId || !appSecret || !appUrl) {
    return NextResponse.json({ error: 'Instagram OAuth не настроен на сервере' }, { status: 500 });
  }

  const state = buildInstagramOAuthState(agentId, user.id, appSecret);
  const redirectUrl = new URL('https://www.instagram.com/oauth/authorize');
  redirectUrl.searchParams.set('client_id', appId);
  redirectUrl.searchParams.set('redirect_uri', `${appUrl}/api/instagram/oauth/callback`);
  redirectUrl.searchParams.set('response_type', 'code');
  redirectUrl.searchParams.set('scope', 'instagram_business_basic,instagram_business_manage_messages');
  redirectUrl.searchParams.set('state', state);

  return NextResponse.redirect(redirectUrl.toString());
}
