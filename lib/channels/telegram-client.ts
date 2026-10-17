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

function escapeTelegramHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function postTelegramMultipart(
  token: string,
  method: 'sendPhoto' | 'sendVideo' | 'sendDocument',
  field: 'photo' | 'video' | 'document',
  chatId: string,
  data: Buffer,
  mime: string,
  fileName: string,
  caption?: string,
) {
  const form = new FormData();
  form.append('chat_id', chatId);
  if (caption) {
    form.append('caption', escapeTelegramHtml(caption));
    form.append('parse_mode', 'HTML');
  }
  if (method === 'sendVideo') form.append('supports_streaming', 'true');
  form.append(field, new Blob([new Uint8Array(data)], { type: mime }), fileName);

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.description ?? `Telegram ${method} failed`);
  }
}

export async function sendTelegramMedia(
  channelId: string,
  externalId: string,
  opts: { url?: string; buffer?: Buffer; mimeType?: string; caption?: string; fileName?: string },
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

  let data = opts.buffer;
  if (!data && opts.url) {
    const res = await fetch(opts.url);
    if (!res.ok) throw new Error(`Failed to download media: ${res.status}`);
    data = Buffer.from(await res.arrayBuffer());
  }
  if (!data) throw new Error('No media provided');

  const mime = opts.mimeType || 'application/octet-stream';
  const fileName = opts.fileName || 'file';

  if (mime.startsWith('image/') && mime !== 'image/gif') {
    try {
      await postTelegramMultipart(token, 'sendPhoto', 'photo', externalId, data, mime, fileName, opts.caption);
      return;
    } catch (e) {
      // Telegram отклоняет фото с экстремальными размерами/пропорциями — отправляем как документ без потери файла.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/PHOTO_|IMAGE_|dimension|too big|file is too/i.test(msg)) throw e;
    }
    await postTelegramMultipart(token, 'sendDocument', 'document', externalId, data, mime, fileName, opts.caption);
  } else if (mime === 'image/gif') {
    await postTelegramMultipart(token, 'sendDocument', 'document', externalId, data, mime, fileName, opts.caption);
  } else if (mime.startsWith('video/')) {
    await postTelegramMultipart(token, 'sendVideo', 'video', externalId, data, mime, fileName, opts.caption);
  } else {
    await postTelegramMultipart(token, 'sendDocument', 'document', externalId, data, mime, fileName, opts.caption);
  }
}
