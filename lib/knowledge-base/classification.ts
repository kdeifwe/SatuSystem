import { normalizeCategory } from '../ai/knowledge/categories.ts';

export type KBChunkPriority = 'qa' | 'structured' | 'chunk';

const QUESTION_MARK_PATTERN = /\?/;
const QA_PATTERN = /(?:^|\n)\s*(?:вопрос|question|q)\s*[:\-]/i;
const ANSWER_PATTERN = /(?:^|\n)\s*(?:ответ|answer|a)\s*[:\-]/i;
const STRUCTURED_PATTERN = /(цена|стоимость|тариф|тарифы|контакты|телефон|email|e-mail|доставка|рассрочка|гарантия|адрес|время работы|условия|период)/i;
const LIST_PATTERN = /(^|\n)\s*(?:[-*•]|\d+\.)\s+/m;

export interface ManualChunkMetadataOptions {
  content: string;
  title: string;
  type?: string;
  sourceName?: string;
  chunkIndex?: number;
}

export function classifyChunkPriority(content: string): KBChunkPriority {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'chunk';

  const firstHalf = normalized.slice(0, Math.floor(normalized.length / 2));
  const isShort = normalized.length < 400;
  const looksLikeQA = (isShort && QUESTION_MARK_PATTERN.test(firstHalf)) || QA_PATTERN.test(normalized) || ANSWER_PATTERN.test(normalized);

  if (looksLikeQA) return 'qa';

  const looksStructured = STRUCTURED_PATTERN.test(normalized) || LIST_PATTERN.test(normalized);
  if (looksStructured) return 'structured';

  return 'chunk';
}

export function buildManualChunkMetadata({
  content,
  title,
  type = 'other',
  sourceName = 'Manual Input',
  chunkIndex = 0,
}: ManualChunkMetadataOptions) {
  const category = normalizeCategory(type);
  const priority = classifyChunkPriority(content);

  return {
    category,
    type: category,
    title,
    source_name: sourceName,
    chunk_index: chunkIndex,
    priority,
  };
}
