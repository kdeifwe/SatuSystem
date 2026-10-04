import { understandMedia, cleanMimeType, type MediaKind } from '@/lib/server/media-understanding';

const TG_EXT_MIME: Record<string, string> = {
  oga: 'audio/ogg', ogg: 'audio/ogg', opus: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
};

async function downloadWhatsAppMedia(mediaId: string, accessToken: string, kind: MediaKind) {
  const metaRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const metaJson = await metaRes.json();
  const url = metaJson?.url;
  if (!url) throw new Error('No media url from Meta Graph API');

  const fileRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!fileRes.ok) throw new Error('Failed to download media');
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const mimeType = cleanMimeType(metaJson?.mime_type ?? fileRes.headers.get('content-type'), kind);
  return { buffer, mimeType };
}

async function downloadTelegramFile(botToken: string, fileId: string, kind: MediaKind, hintedMime?: string | null) {
  const getFileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
  const gf = await getFileRes.json();
  const filePath: string | undefined = gf?.result?.file_path;
  if (!filePath) throw new Error('No file_path from Telegram getFile (файл > 20 МБ?)');

  const fileRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
  if (!fileRes.ok) throw new Error('Failed to download telegram file');
  const buffer = Buffer.from(await fileRes.arrayBuffer());

  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const mimeType = cleanMimeType(TG_EXT_MIME[ext] ?? hintedMime ?? fileRes.headers.get('content-type'), kind);
  return { buffer, mimeType };
}

export async function fetchAndUnderstandWhatsAppMedia(
  mediaId: string, accessToken: string, kind: MediaKind, caption?: string | null,
) {
  const { buffer, mimeType } = await downloadWhatsAppMedia(mediaId, accessToken, kind);
  const text = await understandMedia(buffer, mimeType, kind, caption);
  return { text, buffer, mimeType };
}

export async function fetchAndUnderstandTelegramFile(
  botToken: string, fileId: string, kind: MediaKind, caption?: string | null, hintedMime?: string | null,
) {
  const { buffer, mimeType } = await downloadTelegramFile(botToken, fileId, kind, hintedMime);
  const text = await understandMedia(buffer, mimeType, kind, caption);
  return { text, buffer, mimeType };
}

// обратная совместимость со старыми вызовами
export const fetchAndTranscribeWhatsAppMedia = (mediaId: string, accessToken: string) =>
  fetchAndUnderstandWhatsAppMedia(mediaId, accessToken, 'audio');
export const fetchAndTranscribeTelegramFile = (botToken: string, fileId: string) =>
  fetchAndUnderstandTelegramFile(botToken, fileId, 'audio');

export async function saveBufferToSupabase(adminClient: any, bucket: string, path: string, buffer: Buffer, mimeType: string) {
  const { error } = await adminClient.storage.from(bucket).upload(path, buffer, { contentType: mimeType, upsert: true });
  if (error) throw error;
  return path;
}
