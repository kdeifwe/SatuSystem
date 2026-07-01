export async function extractTextFromBuffer(buffer: ArrayBuffer, mimeType: string, fileName: string): Promise<string> {
  switch (mimeType) {
    case 'text/plain':
    case 'text/markdown':
      return new TextDecoder('utf-8').decode(buffer);

    case 'application/pdf': {
      const { extractText } = await import('unpdf');
      const result = await extractText(new Uint8Array(buffer), { mergePages: true });
      const text = Array.isArray(result.text) ? result.text.join('\n') : result.text;
      if (!text?.trim()) throw new Error(`PDF "${fileName}" пустой или отсканированный — OCR не поддерживается`);
      return text;
    }

    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
      return result.value;
    }

    default:
      throw new Error(`Формат не поддерживается: ${mimeType}. Загружайте PDF, DOCX или TXT.`);
  }
}

export async function extractTextFromURL(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SatuAI-Bot/1.0)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} для ${url}`);

    const html = await res.text();
    const { JSDOM } = await import('jsdom');
    const { Readability } = await import('@mozilla/readability');

    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    const text = article?.textContent ?? html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (!text || text.length < 100) throw new Error(`Мало текста на странице ${url}`);
    return text;
  } finally {
    clearTimeout(timeout);
  }
}
