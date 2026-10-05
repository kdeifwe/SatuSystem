import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const { agentId, token } = await req.json();
  if (!token?.trim()) return NextResponse.json({ error: 'Токен обязателен' }, { status: 400 });

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json();

    if (!data.ok) {
      return NextResponse.json({ error: 'Неверный токен бота' }, { status: 400 });
    }

    const botName = data.result.username;

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: membership } = await admin
      .from('org_members')
      .select('org_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership?.org_id) {
      return NextResponse.json({ error: 'Организация не найдена' }, { status: 404 });
    }

    const { data: existing } = await admin
      .from('channels')
      .select('id, credentials')
      .eq('org_id', membership.org_id)
      .eq('type', 'telegram')
      .maybeSingle();

    const secretToken = existing?.credentials?.secret_token ?? crypto.randomUUID();

    if (existing) {
      await admin.from('channels')
        .update({
          credentials: {
            ...(existing.credentials ?? {}),
            token,
            bot_username: botName,
            agent_id: agentId,
            secret_token: secretToken,
          },
          is_active: true,
        })
        .eq('id', existing.id);
    } else {
      await admin.from('channels').insert({
        org_id: membership.org_id,
        type: 'telegram',
        credentials: { token, bot_username: botName, agent_id: agentId, secret_token: secretToken },
        is_active: true,
      });
    }

    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/telegram/${agentId}`;
    const webhookResponse = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl, secret_token: secretToken }),
    });

    const webhookData = await webhookResponse.json();
    if (!webhookData?.ok) {
      return NextResponse.json({
        error: webhookData?.description ?? 'Не удалось зарегистрировать Telegram webhook',
      }, { status: 400 });
    }

    return NextResponse.json({ success: true, botName });
  } catch (err) {
    return NextResponse.json({ error: 'Ошибка проверки токена' }, { status: 500 });
  }
}
