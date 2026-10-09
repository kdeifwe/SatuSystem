import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseServer } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { verifyGoogleOAuthState } from '@/lib/server/google-oauth-state';
import { encryptSecret } from '@/lib/server/crypto';

export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/dashboard?error=google_calendar_auth_required', appUrl));
  }

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const agentId = req.nextUrl.searchParams.get('state') ? (() => {
    const parts = state?.split('|');
    return parts?.[0] ?? null;
  })() : null;

  if (!code || !state || !agentId) {
    return NextResponse.redirect(new URL(`/dashboard/${agentId ?? ''}/integrations?error=${encodeURIComponent('Google Calendar OAuth: отсутствуют параметры')}`, appUrl));
  }

  const secret = process.env.GOOGLE_OAUTH_STATE_SECRET ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!secret || !verifyGoogleOAuthState(state, agentId, user.id, secret)) {
    return NextResponse.redirect(new URL(`/dashboard/${agentId}/integrations?error=${encodeURIComponent('Google Calendar OAuth: недействительная подпись')}`, appUrl));
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL(`/dashboard/${agentId}/integrations?error=${encodeURIComponent('Google Calendar OAuth: сервер не настроен')}`, appUrl));
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${appUrl}/api/google-calendar/oauth/callback`,
        grant_type: 'authorization_code',
      }).toString(),
    });

    const tokenJson = await tokenResponse.json();
    const refreshToken = typeof tokenJson.refresh_token === 'string' ? tokenJson.refresh_token : null;
    if (!tokenResponse.ok || !refreshToken) {
      throw new Error(tokenJson?.error_description ?? 'Не удалось получить refresh token Google Calendar');
    }

    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    const profileJson = await profileResponse.json();
    const googleEmail = typeof profileJson.email === 'string' ? profileJson.email : null;

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: agent, error: agentError } = await admin.from('agents').select('org_id').eq('id', agentId).single();
    if (agentError || !agent?.org_id) {
      throw new Error('Агент не найден');
    }

    const payload = {
      org_id: agent.org_id,
      agent_id: agentId,
      user_id: user.id,
      google_email: googleEmail,
      status: 'connected',
      refresh_token_encrypted: encryptSecret(refreshToken),
      scopes: Array.isArray(tokenJson.scope) ? tokenJson.scope : String(tokenJson.scope ?? '').split(' ').filter(Boolean),
      last_error: null,
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await admin.from('calendar_connections').select('id').eq('agent_id', agentId).maybeSingle();
    if (existing) {
      await admin.from('calendar_connections').update(payload).eq('id', existing.id);
    } else {
      await admin.from('calendar_connections').insert(payload);
    }

    return NextResponse.redirect(new URL(`/dashboard/${agentId}/integrations?success=${encodeURIComponent('Google Calendar подключён')}`, appUrl));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось подключить Google Calendar';
    return NextResponse.redirect(new URL(`/dashboard/${agentId}/integrations?error=${encodeURIComponent(message)}`, appUrl));
  }
}
