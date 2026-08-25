import { createAdminClient } from '@/lib/supabase/admin';

export async function sendTelegramText(channelId: string, externalId: string, content: string) {
  const admin = createAdminClient();
  const { data: channel, error } = await admin
    .from('channels')
    .select('credentials')
    .eq('id', channelId)
    .single();

  if (error || !channel) {
    throw new Error('Telegram channel not found');
  }

  const token = typeof channel.credentials?.token === 'string' ? channel.credentials.token : '';
  if (!token || !externalId) {
    throw new Error('Telegram bot token or chat id is missing');
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: externalId, text: content, parse_mode: 'HTML' }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.description ?? 'Telegram send failed');
  }
}

export async function sendTelegramMedia(
  channelId: string,
  externalId: string,
  opts: { url: string; mimeType?: string; caption?: string },
) {
  const admin = createAdminClient();
  const { data: channel, error } = await admin
    .from('channels')
    .select('credentials')
    .eq('id', channelId)
    .single();

  if (error || !channel) {
    throw new Error('Telegram channel not found');
  }

  const token = typeof channel.credentials?.token === 'string' ? channel.credentials.token : '';
  if (!token || !externalId) {
    throw new Error('Telegram bot token or chat id is missing');
  }

  const mime = opts.mimeType ?? '';
  let endpoint = '';
  let body: Record<string, unknown> = { chat_id: externalId, caption: opts.caption ?? undefined, parse_mode: 'HTML' };

  if (mime.startsWith('image/') || /\.(jpg|jpeg|png|gif)$/i.test(opts.url)) {
    endpoint = `https://api.telegram.org/bot${token}/sendPhoto`;
    // Telegram accepts URL in `photo` field
    (body as any).photo = opts.url;
  } else if (mime.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(opts.url)) {
    endpoint = `https://api.telegram.org/bot${token}/sendVideo`;
    (body as any).video = opts.url;
  } else {
    endpoint = `https://api.telegram.org/bot${token}/sendDocument`;
    (body as any).document = opts.url;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.description ?? 'Telegram media send failed');
  }
}
