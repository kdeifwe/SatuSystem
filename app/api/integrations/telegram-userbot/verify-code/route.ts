import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

declare global {
  var pendingTGClients: Map<string, any>;
}

if (!global.pendingTGClients) {
  global.pendingTGClients = new Map();
}

export async function POST(req: NextRequest) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
  }

  const { agentId, sessionId, code, phone, apiId, apiHash } = await req.json();
  if (!code?.trim()) {
    return NextResponse.json({ error: 'Код обязателен' }, { status: 400 });
  }

  try {
    const pending = global.pendingTGClients.get(sessionId);
    if (!pending) {
      return NextResponse.json({ error: 'Сессия истекла. Запросите код снова.' }, { status: 400 });
    }

    const { client, phoneCodeHash } = pending;
    const { Api } = await import('telegram');

    await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: phone,
        phoneCodeHash,
        phoneCode: code,
      })
    );

    const sessionString = (client.session as any).save();

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: membership } = await admin
      .from('org_members')
      .select('org_id')
      .eq('user_id', user.id)
      .single();

    const credentials = {
      session_string: sessionString,
      phone,
      api_id: apiId,
      api_hash: apiHash,
      agent_id: agentId,
    };

    const { data: existing } = await admin
      .from('channels')
      .select('id')
      .eq('org_id', membership!.org_id)
      .eq('type', 'telegram_userbot')
      .maybeSingle();

    if (existing) {
      await admin.from('channels').update({ credentials, is_active: true }).eq('id', existing.id);
    } else {
      await admin.from('channels').insert({
        org_id: membership!.org_id,
        type: 'telegram_userbot',
        credentials,
        is_active: true,
      });
    }

    global.pendingTGClients.delete(sessionId);
    await client.disconnect();

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = String(err);
    if (msg.includes('SESSION_PASSWORD_NEEDED')) {
      return NextResponse.json({ error: 'Требуется пароль 2FA', need_password: true }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
