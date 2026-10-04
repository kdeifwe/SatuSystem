import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseServer } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { verifyInstagramOAuthState } from '@/lib/server/instagram-oauth';

async function upsertInstagramChannel(agentId: string, credentials: Record<string, unknown>) {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: agent, error: agentError } = await admin.from('agents').select('org_id').eq('id', agentId).single();
  if (agentError || !agent?.org_id) {
    throw new Error('Агент не найден');
  }

  const { data: existingChannel } = await admin
    .from('channels')
    .select('id, credentials')
    .eq('org_id', agent.org_id)
    .eq('type', 'instagram')
    .maybeSingle();

  const payload = {
    org_id: agent.org_id,
    type: 'instagram',
    credentials: {
      ...((existingChannel?.credentials as Record<string, unknown> | null) ?? {}),
      ...credentials,
      agent_id: agentId,
    },
    is_active: true,
    connection_status: 'connected',
  };

  if (existingChannel) {
    const { error } = await admin.from('channels').update(payload).eq('id', existingChannel.id);
    if (error) throw error;
    return existingChannel.id;
  }

  const { data: channel, error } = await admin.from('channels').insert(payload).select('id').single();
  if (error || !channel) throw error ?? new Error('Не удалось создать канал Instagram');
  return channel.id;
}

export async function GET(req: NextRequest) {
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  const appId = process.env.INSTAGRAM_APP_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const redirectUrl = `${appUrl ?? ''}/dashboard`;

  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/dashboard?error=instagram_auth_required', appUrl ?? 'http://localhost:3000'));

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const agentId = req.nextUrl.searchParams.get('state') ? (() => {
    const parsed = state?.split('|');
    return parsed?.[0] ?? null;
  })() : null;

  if (!appId || !appSecret || !appUrl || !code || !state || !agentId) {
    return NextResponse.redirect(new URL(`/dashboard?error=${encodeURIComponent('Instagram OAuth: отсутствуют параметры')}`, appUrl ?? 'http://localhost:3000'));
  }

  if (!verifyInstagramOAuthState(state, agentId, user.id, appSecret)) {
    return NextResponse.redirect(new URL(`/dashboard?error=${encodeURIComponent('Instagram OAuth: недействительная подпись state')}`, appUrl ?? 'http://localhost:3000'));
  }

  try {
    const tokenResponse = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: 'authorization_code',
        redirect_uri: `${appUrl}/api/instagram/oauth/callback`,
        code,
      }).toString(),
    });

    const tokenJson = await tokenResponse.json();
    const shortLivedToken = tokenJson?.access_token;
    if (!tokenResponse.ok || !shortLivedToken) {
      throw new Error(tokenJson?.error_message ?? 'Не удалось получить токен Instagram');
    }

    const exchangeResponse = await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(appSecret)}&access_token=${encodeURIComponent(shortLivedToken)}`);
    const exchangeJson = await exchangeResponse.json();
    const accessToken = exchangeJson?.access_token;
    const expiresAtRaw = exchangeJson?.expires_in ? Date.now() + Number(exchangeJson.expires_in) * 1000 : null;
    if (!exchangeResponse.ok || !accessToken) {
      throw new Error(exchangeJson?.error?.message ?? 'Не удалось обменять токен Instagram');
    }

    const profileResponse = await fetch(`https://graph.instagram.com/me?fields=user_id,username&access_token=${encodeURIComponent(accessToken)}`);
    const profileJson = await profileResponse.json();
    const igUserId = profileJson?.user_id ?? profileJson?.id;
    const username = profileJson?.username ?? null;
    if (!igUserId) {
      throw new Error('Не удалось получить идентификатор Instagram');
    }

    await upsertInstagramChannel(agentId, {
      ig_user_id: String(igUserId),
      username: typeof username === 'string' ? username : null,
      access_token: accessToken,
      expires_at: expiresAtRaw ?? null,
    });

    const subscribeResponse = await fetch(`https://graph.instagram.com/v22.0/${igUserId}/subscribed_apps?subscribed_fields=messages&access_token=${encodeURIComponent(accessToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!subscribeResponse.ok) {
      const data = await subscribeResponse.json().catch(() => ({}));
      console.warn('[instagram oauth] subscribed_apps failed', data);
    }

    return NextResponse.redirect(new URL(`/dashboard/${agentId}/integrations?success=${encodeURIComponent('Instagram подключён')}`, appUrl));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось подключить Instagram';
    return NextResponse.redirect(new URL(`/dashboard/${agentId}/integrations?error=${encodeURIComponent(message)}`, appUrl));
  }
}
