import { createClient } from '@supabase/supabase-js';

// Use the OpenAI speech-to-text model recommended as of 2026-07-28
const OPENAI_STT_MODEL = process.env.OPENAI_STT_MODEL || 'gpt-transcribe';

export async function fetchAndTranscribeWhatsAppMedia(mediaId: string, accessToken: string) {
  // 1) get media URL from Meta Graph API
  const metaRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const metaJson = await metaRes.json();
  const url = metaJson?.url;
  if (!url) throw new Error('No media url from Meta Graph API');

  // 2) GET binary using same bearer
  const fileRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!fileRes.ok) throw new Error('Failed to download media');
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const contentType = fileRes.headers.get('content-type') ?? 'audio/ogg';
  const filename = `${mediaId}.${contentType.split('/')[1] ?? 'ogg'}`;

  // 3) transcribe via OpenAI
  const transcription = await transcribeBufferWithOpenAI(buffer, filename, contentType);
  return { text: transcription, buffer, mimeType: contentType };
}

export async function fetchAndTranscribeTelegramFile(botToken: string, fileId: string) {
  const getFileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
  const gf = await getFileRes.json();
  const filePath = gf?.result?.file_path;
  if (!filePath) throw new Error('No file_path from Telegram getFile');
  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) throw new Error('Failed to download telegram file');
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const contentType = fileRes.headers.get('content-type') ?? 'audio/ogg';
  const filename = `${fileId}.${contentType.split('/')[1] ?? 'ogg'}`;
  const transcription = await transcribeBufferWithOpenAI(buffer, filename, contentType);
  return { text: transcription, buffer, mimeType: contentType };
}

async function transcribeBufferWithOpenAI(buffer: Buffer, filename: string, mimeType: string) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  form.append('file', blob, filename);
  form.append('model', OPENAI_STT_MODEL);

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form as any,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI STT failed: ${res.status} ${body}`);
  }
  const json = await res.json();
  return json?.text ?? '';
}

export async function saveBufferToSupabase(adminClient: any, bucket: string, path: string, buffer: Buffer, mimeType: string) {
  // upload (overwrite)
  const { error } = await adminClient.storage.from(bucket).upload(path, buffer, { contentType: mimeType, upsert: true });
  if (error) {
    throw error;
  }
  // Return storage path (NOT signed URL) for persistent storage reference
  return path;
}
