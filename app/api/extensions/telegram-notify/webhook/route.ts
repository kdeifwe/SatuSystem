import { createAdminClient } from '@/lib/supabase/admin';
import { parseTelegramNotificationCommand, sendTelegramNotification } from '@/lib/extensions/telegram-notify';

async function getProfileByChatId(admin: ReturnType<typeof createAdminClient>, chatId: string) {
  return admin
    .from('profiles')
    .select('id, full_name, telegram_chat_id')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const challenge = searchParams.get('hub.challenge');

  if (challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const messageText = typeof body?.message?.text === 'string' ? body.message.text : '';
    const command = parseTelegramNotificationCommand(messageText);
    const chatId = String(body?.message?.chat?.id ?? '');

    if (command.kind === 'other' || !chatId) {
      return Response.json({ ok: true });
    }

    const admin = createAdminClient();

    if (command.token) {
      const { data: profile, error } = await admin
        .from('profiles')
        .select('id, full_name')
        .eq('telegram_link_token', command.token)
        .gt('telegram_link_token_expires_at', new Date().toISOString())
        .maybeSingle();

      if (error || !profile) {
        await sendTelegramNotification(
          chatId,
          '❌ Ссылка недействительна или уже истекла. Получите новую ссылку в настройках расширения.'
        );
        return Response.json({ ok: true });
      }

      await admin
        .from('profiles')
        .update({
          telegram_chat_id: chatId,
          telegram_link_token: null,
          telegram_link_token_expires_at: null,
        })
        .eq('id', profile.id);

      await sendTelegramNotification(
        chatId,
        `Привет! Я буду уведомлять тебя о событиях в Satu.AI. Ты подключён как ${profile.full_name ?? 'участник'} ✅`
      );

      return Response.json({ ok: true });
    }

    const { data: existingProfile } = await getProfileByChatId(admin, chatId);

    if (existingProfile?.full_name) {
      await sendTelegramNotification(
        chatId,
        `Привет! Я буду уведомлять тебя о событиях в Satu.AI. Ты подключён как ${existingProfile.full_name} ✅`
      );
    } else {
      await sendTelegramNotification(
        chatId,
        'Привет! Я буду уведомлять тебя о событиях в Satu.AI. Чтобы завершить подключение, откройте ссылку из настроек расширения.'
      );
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error('[telegram-notify webhook]', error);
    return Response.json({ ok: true });
  }
}
