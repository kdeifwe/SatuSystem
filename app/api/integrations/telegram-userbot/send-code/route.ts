import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';

const pendingTGClients = new Map<string, { client: any; phoneCodeHash: string }>();

export async function POST(req: NextRequest) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
  }

  const { agentId, phone, apiId, apiHash } = await req.json();
  if (!phone?.trim()) {
    return NextResponse.json({ error: 'Номер телефона обязателен' }, { status: 400 });
  }
  if (!apiId || !apiHash) {
    return NextResponse.json({ error: 'Нужны API ID и API Hash. Получите их на my.telegram.org/apps' }, { status: 400 });
  }

  try {
    const { TelegramClient } = await import('telegram');
    const { StringSession } = await import('telegram/sessions');

    const client = new TelegramClient(
      new StringSession(''),
      Number(apiId),
      apiHash,
      { connectionRetries: 3 }
    );

    await client.connect();
    const result = (await client.invoke(
      new (await import('telegram')).Api.auth.SendCode({
        phoneNumber: phone,
        apiId: Number(apiId),
        apiHash,
        settings: new (await import('telegram')).Api.CodeSettings({}),
      })
    )) as any;

    const phoneCodeHash = result?.phoneCodeHash ?? result?.phone_code_hash;
    const sessionId = `telegram-userbot-${agentId}-${Date.now()}`;
    pendingTGClients.set(sessionId, { client, phoneCodeHash });

    return NextResponse.json({ success: true, sessionId });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
