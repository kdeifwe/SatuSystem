function looksLikeDirectFactQuestion(message: string): boolean {
  const lower = (message ?? '').toLowerCase();
  return /(канша|сколько|срок|длитель|длится|длиться|ұзақты|месяц|месяцев|ай|цена|стоимость|құны|предмет|пән|входит|включает|register|регист|тіркел|how long|how much|price|duration|cost)/i.test(lower);
}

function normalizeGradeValue(value: string | number | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{1,2})/);
    if (match) return Number(match[1]);
  }
  return null;
}

function extractGradeLabels(text: string): number[] {
  const lower = (text ?? '').toLowerCase();
  const matches = Array.from(lower.matchAll(/\b(9|10|11|12)\b(?:\s*(?:класс(?:а|ов|ы|у)?|сынып|grade|class))?/g));
  const grades = matches
    .map((match) => match[1])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  return Array.from(new Set(grades));
}

function scoreChunkForGrade(chunk: { content?: string; similarity?: number }, grade: number | null): number {
  if (grade === null) return 0;
  const labels = extractGradeLabels(chunk.content ?? '');
  return labels.includes(grade) ? 2 : 0;
}

export function tryBuildDeterministicFactAnswer(
  message: string,
  chunks: Array<{ content?: string; similarity?: number }> = [],
  leadGrade?: string | number | null,
): string | null {
  if (!looksLikeDirectFactQuestion(message) || !chunks.length) return null;

  const normalizedLeadGrade = normalizeGradeValue(leadGrade);
  const lowerMessage = (message ?? '').toLowerCase();
  const scoredChunks = chunks
    .map((chunk, index) => ({
      chunk,
      gradeScore: scoreChunkForGrade(chunk, normalizedLeadGrade),
      similarity: typeof chunk.similarity === 'number' ? chunk.similarity : 0,
      index,
    }))
    .sort((a, b) => {
      if (b.gradeScore !== a.gradeScore) return b.gradeScore - a.gradeScore;
      if (b.similarity !== a.similarity) return b.similarity - a.similarity;
      return a.index - b.index;
    });

  for (const { chunk } of scoredChunks) {
    const content = chunk.content ?? '';
    const lowerContent = content.toLowerCase();

    if (/(канша|сколько|срок|длитель|длится|длиться|ұзақты|месяц|месяцев|ай)/i.test(lowerMessage)) {
      const durationMatch = content.match(/(\d+)\s*(?:ай|месяц(?:ев)?|month(?:s)?|мес)/i);
      if (durationMatch) {
        const value = durationMatch[1];
        const matchedUnit = durationMatch[0].match(/ай|месяц(?:ев)?|month(?:s)?|мес/i)?.[0] ?? 'месяцев';
        const unit = matchedUnit.toLowerCase().includes('month') || matchedUnit.toLowerCase().includes('месяц') || matchedUnit.toLowerCase().includes('мес')
          ? 'месяцев'
          : 'ай';
        return `Срок обучения — ${value} ${unit}.`;
      }
    }

    if (/(цена|стоимость|сколько стоит|құны|price|fee|cost)/i.test(lowerMessage)) {
      const priceMatch = content.match(/(\d[\s\d]{0,3}(?:тг|₸|kzt|тенге))/i);
      if (priceMatch) {
        return `Стоимость — ${priceMatch[1]}.`;
      }
    }

    if (/(предмет|пән|subjects|subject)/i.test(lowerMessage) && /пән|предмет/i.test(lowerContent)) {
      const subjectMatch = content.match(/([А-Яа-яЁёA-Za-z0-9\s\-]+(?:пән|предмет|subject))/i);
      if (subjectMatch) {
        return `По этому курсу обычно рассматриваются: ${subjectMatch[1].trim()}.`;
      }
    }
  }

  return null;
}
