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
      const now = new Date().toISOString();
      console.error('[telegram-notify webhook] /start command received', {
        token: command.token,
        chatId,
        now,
      });

      const { data: profile, error } = await admin
        .from('profiles')
        .select('id, full_name, telegram_link_token, telegram_link_token_expires_at')
        .eq('telegram_link_token', command.token)
        .maybeSingle();

      console.error('[telegram-notify webhook] query result', {
        token: command.token,
        foundProfile: !!profile,
        error: error?.message || null,
        profileToken: profile?.telegram_link_token,
        profileExpiry: profile?.telegram_link_token_expires_at,
        now,
      });

      if (error) {
        console.error('[telegram-notify webhook] database error', error);
        await sendTelegramNotification(
          chatId,
          '❌ Ошибка при обработке ссылки. Попробуйте позже.'
        );
        return Response.json({ ok: true });
      }

      if (!profile) {
        console.error('[telegram-notify webhook] profile not found for token', { token: command.token });
        await sendTelegramNotification(
          chatId,
          '❌ Ссылка недействительна или уже истекла. Получите новую ссылку в настройках расширения.'
        );
        return Response.json({ ok: true });
      }

      if (!profile.telegram_link_token_expires_at) {
        console.error('[telegram-notify webhook] token has no expiry', { profileId: profile.id });
        await sendTelegramNotification(
          chatId,
          '❌ Ссылка недействительна. Получите новую ссылку в настройках расширения.'
        );
        return Response.json({ ok: true });
      }

      if (new Date(profile.telegram_link_token_expires_at) <= new Date(now)) {
        console.error('[telegram-notify webhook] token expired', {
          profileId: profile.id,
          expiry: profile.telegram_link_token_expires_at,
          now,
        });
        await sendTelegramNotification(
          chatId,
          '❌ Ссылка истекла. Получите новую ссылку в настройках расширения.'
        );
        return Response.json({ ok: true });
      }

      console.error('[telegram-notify webhook] valid link token accepted', {
        token: command.token,
        profileId: profile.id,
        timestamp: now,
      });

      // UPDATE профайла СНАЧАЛА, ДО отправки сообщения в Telegram
      const { error: updateError } = await admin
        .from('profiles')
        .update({
          telegram_chat_id: chatId,
          telegram_link_token: null,
          telegram_link_token_expires_at: null,
        })
        .eq('id', profile.id);

      if (updateError) {
        console.error('[telegram-notify webhook] failed to update profile', {
          profileId: profile.id,
          error: updateError.message,
        });
        // Даже если UPDATE не прошел, отправляем сообщение об успехе
        try {
          await sendTelegramNotification(
            chatId,
            'Ссылка активирована! ✅'
          );
        } catch (sendError) {
          console.error('[telegram-notify webhook] failed to send success message', {
            error: sendError instanceof Error ? sendError.message : String(sendError),
          });
        }
        return Response.json({ ok: true });
      }

      console.error('[telegram-notify webhook] profile updated successfully', {
        profileId: profile.id,
        chatId,
      });

      // ЗАТЕМ отправляем сообщение
      try {
        await sendTelegramNotification(
          chatId,
          `Привет! Я буду уведомлять тебя о событиях в Satu.AI. Ты подключён как ${profile.full_name ?? 'участник'} ✅`
        );
        console.error('[telegram-notify webhook] notification sent successfully', {
          profileId: profile.id,
          chatId,
        });
      } catch (sendError) {
        console.error('[telegram-notify webhook] failed to send notification after profile update', {
          profileId: profile.id,
          chatId,
          error: sendError instanceof Error ? sendError.message : String(sendError),
        });
        // Профайл уже обновлен, поэтому вернуть успех
      }

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
