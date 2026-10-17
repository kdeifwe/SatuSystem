// Правила для медиа-файлов, которые агент может отправлять клиентам.
// Используется и на сервере (валидация загрузки), и в UI (accept / ограничения).

export type MediaKind = 'image' | 'video' | 'document';

const MB = 1024 * 1024;

export const MEDIA_LIMITS: Record<MediaKind, number> = {
  image: 10 * MB, // лимит Telegram sendPhoto
  video: 16 * MB, // лимит WhatsApp для видео
  document: 20 * MB,
};

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
};

const ALLOWED_MIME: Record<string, MediaKind> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'video/mp4': 'video',
  'application/pdf': 'document',
};

export const MEDIA_ACCEPT_ATTR = Object.keys(ALLOWED_MIME).join(',');

export type MediaValidation =
  | { ok: true; kind: MediaKind; mime: string }
  | { ok: false; error: string };

export function resolveMime(name: string, type?: string | null): string {
  const t = String(type || '').toLowerCase().trim();
  if (t && ALLOWED_MIME[t]) return t;
  const ext = String(name || '').split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? t;
}

export function detectMediaKind(mime: string | null | undefined): MediaKind | null {
  return ALLOWED_MIME[String(mime || '').toLowerCase()] ?? null;
}

export function validateMediaFile(file: { name: string; size: number; type?: string | null }): MediaValidation {
  const mime = resolveMime(file.name, file.type);
  const kind = detectMediaKind(mime);
  if (!kind) {
    return { ok: false, error: `Формат файла «${file.name}» не поддерживается. Разрешены: JPG, PNG, WEBP, GIF, MP4, PDF.` };
  }
  if (file.size <= 0) {
    return { ok: false, error: `Файл «${file.name}» пустой.` };
  }
  if (file.size > MEDIA_LIMITS[kind]) {
    return { ok: false, error: `Файл «${file.name}» слишком большой (максимум ${Math.round(MEDIA_LIMITS[kind] / MB)} МБ).` };
  }
  return { ok: true, kind, mime };
}

// Подпись в messages.media_url для файлов из бакета kb-files (чтобы UI мог выдать свежую ссылку).
export const KB_MEDIA_PREFIX = 'kb-files:';
