const CHARS_PER_TOKEN = 4;
const TARGET_TOKENS   = 700;
const OVERLAP_RATIO   = 0.12;
const TARGET_CHARS    = TARGET_TOKENS * CHARS_PER_TOKEN;       // 2800
const OVERLAP_CHARS   = Math.floor(TARGET_CHARS * OVERLAP_RATIO); // ~336

export interface Chunk {
  content: string;
  metadata: { chunk_index: number; char_start: number; char_end: number; source_title?: string };
}

export function chunkText(text: string, sourceTitle?: string): Chunk[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  if (normalized.length <= TARGET_CHARS) {
    return [{ content: normalized, metadata: { chunk_index: 0, char_start: 0, char_end: normalized.length, source_title: sourceTitle } }];
  }

  const chunks: Chunk[] = [];
  let start = 0, chunkIndex = 0;

  while (start < normalized.length) {
    const end = Math.min(start + TARGET_CHARS, normalized.length);
    let breakPoint = end;

    if (end < normalized.length) {
      const window = normalized.substring(start, end);
      const paraBreak     = window.lastIndexOf('\n\n');
      const sentenceBreak = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '), window.lastIndexOf('.\n'));
      const wordBreak     = window.lastIndexOf(' ');
      const minBreak      = TARGET_CHARS * 0.6;
      if (paraBreak > minBreak)          breakPoint = start + paraBreak + 2;
      else if (sentenceBreak > minBreak) breakPoint = start + sentenceBreak + 2;
      else if (wordBreak > 0)            breakPoint = start + wordBreak + 1;
    }

    const content = normalized.substring(start, breakPoint).trim();
    if (content.length > 0) {
      chunks.push({ content, metadata: { chunk_index: chunkIndex++, char_start: start, char_end: breakPoint, source_title: sourceTitle } });
    }
    start = Math.max(start + 1, breakPoint - OVERLAP_CHARS);
  }
  return chunks;
}

// Q&A: каждая пара — один чанк (priority='qa', высший приоритет при поиске)
export function chunkQAPair(question: string, answer: string, index: number, sourceTitle?: string): Chunk {
  return {
    content:  `Вопрос: ${question}\nОтвет: ${answer}`,
    metadata: { chunk_index: index, char_start: 0, char_end: 0, source_title: sourceTitle },
  };
}
