import { MEDIA_CATEGORIES } from './categories.ts';
import { detectMediaKind, type MediaKind } from './files.ts';

export const SEND_MEDIA_TOOL = 'sendMediaToClient';
export const MAX_MEDIA_PER_TURN = 3;
const MAX_FILES_IN_PROMPT = 30;

export interface MediaFileInfo {
  id: string;
  title: string;
  category: string;
  description: string;
  mimeType: string;
  kind: MediaKind | null;
  storagePath: string | null;
}

export function cleanMediaTitle(raw: unknown): string {
  return String(raw ?? '').replace(/\s+-\s+\d{4}-\d{2}-\d{2}$/, '').trim() || 'Файл';
}

export function categoryLabel(id: string): string {
  return MEDIA_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export function toMediaFileInfo(row: any): MediaFileInfo | null {
  const meta = (row?.metadata ?? {}) as Record<string, unknown>;
  const category = typeof meta.media_category === 'string' ? meta.media_category.trim() : '';
  if (!row?.id || !category) return null;
  const mimeType = typeof meta.mime_type === 'string' ? meta.mime_type : '';
  const storagePath = (typeof meta.storage_path === 'string' && meta.storage_path) || row.file_path || null;
  return {
    id: String(row.id),
    title: cleanMediaTitle(meta.media_title ?? row.title),
    category,
    description: typeof meta.media_description === 'string' ? meta.media_description.trim() : '',
    mimeType,
    kind: detectMediaKind(mimeType),
    storagePath,
  };
}

/**
 * Все файлы агента, помеченные категорией медиа. Статус обработки текста (kb_sources.status)
 * не важен: для отправки нужен только сам файл в хранилище.
 */
export async function loadAgentMediaFiles(admin: any, agentId: string): Promise<MediaFileInfo[]> {
  try {
    const { data, error } = await admin
      .from('kb_sources')
      .select('id, title, metadata, file_path, created_at')
      .eq('agent_id', agentId)
      .eq('type', 'file')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error || !Array.isArray(data)) {
      if (error) console.warn('[MEDIA] failed to load media files', error.message);
      return [];
    }
    return data.map(toMediaFileInfo).filter((f): f is MediaFileInfo => Boolean(f && f.storagePath));
  } catch (e) {
    console.warn('[MEDIA] loadAgentMediaFiles threw', e);
    return [];
  }
}

export function uniqueCategories(files: MediaFileInfo[]): string[] {
  return Array.from(new Set(files.map((f) => f.category)));
}

/** sendMediaToClient доступен автоматически, как только у агента есть хотя бы один файл. */
export function withMediaTool(allowedToolNames: string[], files: MediaFileInfo[]): string[] {
  if (files.length === 0) return allowedToolNames;
  if (allowedToolNames.includes(SEND_MEDIA_TOOL)) return allowedToolNames;
  return [...allowedToolNames, SEND_MEDIA_TOOL];
}

export function buildMediaPromptSection(files: MediaFileInfo[]): string {
  if (files.length === 0) return '';
  const list = files.slice(0, MAX_FILES_IN_PROMPT).map((f) => {
    const desc = f.description ? ` — ${f.description}` : '';
    return `- file_id=${f.id} | «${f.title}» | ${categoryLabel(f.category)}${desc}`;
  });
  return [
    'ФАЙЛЫ ДЛЯ ОТПРАВКИ КЛИЕНТУ (инструмент sendMediaToClient):',
    ...list,
    '',
    'Правила работы с файлами:',
    '- Если клиент просит фото, прайс, каталог, видео или файл — вызови sendMediaToClient с подходящим file_id. Это реальная отправка в чат.',
    '- Если клиент выбирает товар/услугу и фото помогает продать — можно предложить и отправить фото без просьбы.',
    '- Никогда не пиши «отправил/прикрепил/высылаю фото», если не вызвал sendMediaToClient в этом ответе.',
    '- Выбирай файл по названию и описанию. Не выдумывай file_id — только из списка выше.',
    `- Не больше ${MAX_MEDIA_PER_TURN} файлов за один ответ. Не отправляй повторно файл, который уже отправлен в этом диалоге (в истории он отмечен 📎).`,
    '- Если подходящего файла нет в списке — честно скажи, что фото сейчас нет, и опиши словами. Не обещай прислать позже.',
    '- После отправки напиши одну короткую фразу-подводку. Не вставляй ссылки и не упоминай технические детали.',
  ].join('\n');
}

export function injectMediaSection(prompt: string, files: MediaFileInfo[]): string {
  const section = buildMediaPromptSection(files);
  return section ? `${prompt}\n\n${section}` : prompt;
}
