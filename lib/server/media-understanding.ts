import { geminiFetch } from '@/lib/server/ai/gemini-client';

export type MediaKind = 'audio' | 'image' | 'video';

const GEMINI_MEDIA_MODEL = process.env.GEMINI_MEDIA_MODEL || 'gemini-2.5-flash';
// inlineData: лимит запроса ~20 МБ, base64 раздувает на ~33%
const MAX_INLINE_BYTES = 14 * 1024 * 1024;

const PROMPTS: Record<MediaKind, string> = {
  audio:
    'Расшифруй это голосовое сообщение дословно на том языке, на котором оно сказано (русский или казахский). ' +
    'Верни ТОЛЬКО текст расшифровки, без комментариев. Если речи нет — верни пустую строку.',
  image:
    'Это фото от клиента в чате. Опиши кратко, что на нём (1–3 предложения). ' +
    'Затем дословно перепиши весь видимый текст: цены, названия, никнеймы, суммы, даты, номера. ' +
    'Если это чек или скриншот оплаты — укажи сумму, дату, статус и получателя. ' +
    'Формат: «Описание: ... Текст на фото: ...». Без лишних вступлений.',
  video:
    'Это видео от клиента в чате. Кратко опиши, что в нём происходит (1–3 предложения), ' +
    'и дословно перепиши речь, если она есть. Без лишних вступлений.',
};

const LABELS: Record<MediaKind, string> = {
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

export async function understandMedia(
  buffer: Buffer,
  mimeType: string,
  kind: MediaKind,
  caption?: string | null,
): Promise<string> {
  if (buffer.length > MAX_INLINE_BYTES) {
    throw new Error(`Media too large for inline processing: ${buffer.length} bytes`);
  }

  const res = await geminiFetch(GEMINI_MEDIA_MODEL, 'generateContent', {
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: cleanMimeType(mimeType, kind), data: buffer.toString('base64') } },
          { text: PROMPTS[kind] },
        ],
      },
    ],
    generationConfig: { temperature: 0, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini media failed: ${res.status} ${body.slice(0, 300)}`);
  }

  const json: any = await res.json();
  const described = String(
    (json?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('')
  ).trim();
  const cap = String(caption ?? '').trim();

  if (kind === 'audio') return described;
  if (!described && !cap) return '';
  return [LABELS[kind], described, cap ? `Подпись клиента: ${cap}` : ''].filter(Boolean).join('\n');
}
