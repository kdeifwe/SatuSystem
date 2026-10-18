// Понимание медиа от клиента без Gemini: всё идёт через OpenRouter (тот же ключ и баланс, что у Claude).
//  - голосовые: OpenRouter Speech-to-Text (Whisper), модель из OPENROUTER_STT_MODEL
//  - фото: Claude с поддержкой изображений (OPENROUTER_VISION_MODEL или OPENROUTER_DEFAULT_MODEL)
//  - видео: содержимое не анализируется, агент только узнаёт, что клиент прислал видео

export type MediaKind = 'audio' | 'image' | 'video';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const MAX_BYTES = 20 * 1024 * 1024;

const STT_MODELS: string[] = [
  process.env.OPENROUTER_STT_MODEL || '',
  'openai/whisper-large-v3',
  'openai/whisper-1',
].filter((name, index, all) => Boolean(name) && all.indexOf(name) === index);

const IMAGE_PROMPT =
  'Это фото от клиента в чате. Опиши кратко, что на нём (1–3 предложения). ' +
  'Затем дословно перепиши весь видимый текст: цены, названия, никнеймы, суммы, даты, номера. ' +
  'Если это чек или скриншот оплаты — укажи сумму, дату, статус и получателя. ' +
  'Формат: «Описание: ... Текст на фото: ...». Без лишних вступлений.';

const LABELS = {
  audio: '',
  image: '[Клиент прислал фото]',
  video: '[Клиент прислал видео]',
};

/** "audio/ogg; codecs=opus" -> "audio/ogg" */
export function cleanMimeType(mime: string | null | undefined, kind: MediaKind): string {
  const base = String(mime ?? '').split(';')[0].trim().toLowerCase();
  if (base && base !== 'application/octet-stream') return base;
  return kind === 'audio' ? 'audio/ogg' : kind === 'image' ? 'image/jpeg' : 'video/mp4';
}

function audioFormatFromMime(mimeType: string): string {
  const mime = cleanMimeType(mimeType, 'audio');
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('aac')) return 'aac';
  if (mime.includes('flac')) return 'flac';
  return 'ogg';
}

async function transcribeAudio(buffer: Buffer, mimeType: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  const format = audioFormatFromMime(mimeType);
  const data = buffer.toString('base64');
  let lastError = '';

  for (const model of STT_MODELS) {
    const res = await fetch(`${OPENROUTER_BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input_audio: { data, format } }),
    });

    if (res.ok) {
      const json: any = await res.json();
      return String(json?.text ?? '').trim();
    }

    const body = await res.text().catch(() => '');
    lastError = `${model}: ${res.status} ${body.slice(0, 300)}`;
    // Ключ или баланс: другая модель не поможет.
    if (res.status === 401 || res.status === 402 || res.status === 403) break;
  }

  throw new Error(`OpenRouter STT failed: ${lastError}`);
}

async function describeImage(buffer: Buffer, mimeType: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  const model = process.env.OPENROUTER_VISION_MODEL || process.env.OPENROUTER_DEFAULT_MODEL;
  if (!model) throw new Error('OPENROUTER_VISION_MODEL / OPENROUTER_DEFAULT_MODEL is not set');

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${buffer.toString('base64')}` } },
            { type: 'text', text: IMAGE_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenRouter vision failed: ${model}: ${res.status} ${body.slice(0, 300)}`);
  }

  const json: any = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map((part: any) => part?.text ?? '').join('').trim();
  return '';
}

export async function understandMedia(
  buffer: Buffer,
  mimeType: string,
  kind: MediaKind,
  caption?: string | null,
): Promise<string> {
  if (buffer.length > MAX_BYTES) {
    throw new Error(`Media too large for processing: ${buffer.length} bytes`);
  }

  const mime = cleanMimeType(mimeType, kind);
  const cap = String(caption ?? '').trim();

  if (kind === 'audio') {
    return transcribeAudio(buffer, mime);
  }

  if (kind === 'image') {
    const described = await describeImage(buffer, mime);
    if (!described && !cap) return '';
    return [LABELS.image, described, cap ? `Подпись клиента: ${cap}` : ''].filter(Boolean).join('\n');
  }

  // Видео: содержимое не разбираем, сообщаем агенту сам факт и подпись.
  return [LABELS.video, cap ? `Подпись клиента: ${cap}` : ''].filter(Boolean).join('\n');
}
