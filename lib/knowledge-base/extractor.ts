// lib/knowledge-base/extractor.ts
// Extracts plain text from uploaded files (PDF, DOCX, TXT, MD)
// Runs server-side only

export type SupportedMimeType =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'text/plain'
  | 'text/markdown';

export async function extractTextFromBuffer(
  buffer: ArrayBuffer,
  mimeType: string,
  fileName: string,
): Promise<string> {
  return extractTextFromFile(buffer, mimeType, fileName);
}

export async function extractTextFromFile(
  buffer: ArrayBuffer,
  mimeType: string,
  fileName: string,
): Promise<string> {
  if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
    return new TextDecoder().decode(buffer);
  }

  if (mimeType === 'application/pdf') {
    return extractFromPDF(buffer);
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return extractFromDOCX(buffer);
  }

  throw new Error(`Неподдерживаемый тип файла: ${mimeType} (${fileName})`);
}

async function extractFromPDF(buffer: ArrayBuffer): Promise<string> {
  // Uses pdf-parse (npm install pdf-parse @types/pdf-parse)
  // Dynamic import to keep server-side only
  const pdfParse = (await import('pdf-parse')).default as unknown as (input: Buffer) => Promise<{ text: string }>;
  const data = await pdfParse(Buffer.from(buffer));
  return data.text;
}

async function extractFromDOCX(buffer: ArrayBuffer): Promise<string> {
  // Uses mammoth (npm install mammoth)
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
  return result.value;
}

/**
 * Fetches and extracts text from a URL.
 * Basic implementation — for production consider using a proper scraper.
 */
export async function extractTextFromURL(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KnowledgeBot/1.0)' },
  });
  if (!res.ok) throw new Error(`Не удалось загрузить URL: ${res.status}`);

  const html = await res.text();

  // Strip HTML tags — good enough for most landing pages and docs
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return text;
}