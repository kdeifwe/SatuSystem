export type TelegramNotificationCommand =
  | { kind: 'start'; token?: string }
  | { kind: 'other' };

export function parseTelegramNotificationCommand(text?: string): TelegramNotificationCommand {
  const trimmed = text?.trim();

  if (!trimmed) {
    return { kind: 'other' };
  }

  if (trimmed === '/start') {
    console.error('[parseTelegramNotificationCommand] plain /start command');
    return { kind: 'start' };
  }

  if (trimmed.startsWith('/start ')) {
    const token = trimmed.slice(7).trim(); // more reliable than replace
    console.error('[parseTelegramNotificationCommand] parsed /start with token', { token, textLength: text?.length });
    return { kind: 'start', token: token || undefined };
  }

  return { kind: 'other' };
}

export function buildTelegramNotificationsWebhookUrl(appUrl?: string): string {
  const baseUrl = (appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? '').replace(/\/$/, '');

  if (!baseUrl) {
    return '/api/extensions/telegram-notify/webhook';
  }

  return `${baseUrl}/api/extensions/telegram-notify/webhook`;
}

export async function sendTelegramNotification(chatId: string | number, message: string): Promise<void> {
  const token = process.env.TELEGRAM_NOTIFICATIONS_BOT_TOKEN;

  if (!token) {
    throw new Error('TELEGRAM_NOTIFICATIONS_BOT_TOKEN не задан в .env.local');
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Telegram API error: ${JSON.stringify(err)}`);
  }
}

export async function registerTelegramNotificationsWebhook(appUrl?: string): Promise<void> {
  const token = process.env.TELEGRAM_NOTIFICATIONS_BOT_TOKEN;
  const webhookUrl = buildTelegramNotificationsWebhookUrl(appUrl);

  if (!token || !webhookUrl || webhookUrl.startsWith('/')) {
    return;
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Telegram webhook registration failed: ${JSON.stringify(err)}`);
  }
}
