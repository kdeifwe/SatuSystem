export interface SplitMessage {
  text: string;
  delayMs: number;
}

export function splitAgentMessage(text: string, enabled: boolean, maxParts = 3): SplitMessage[] {
  if (!enabled) return [{ text, delayMs: 0 }];

  const cleaned = text.trim();
  const parts: string[] = [];

  // Разбиение по маркеру ||| (LLM сам разделяет мысли)
  const byMarker = cleaned.split(/\s*\|\|\|\s*/).filter((part) => part.trim().length > 0);
  if (byMarker.length >= 2 && byMarker.length <= maxParts) {
    return byMarker.map((part, index) => ({
      text: part.trim(),
      delayMs: index === 0 ? 0 : 2000 * index,
    }));
  }

  const byDoubleNewline = cleaned.split(/\n\n+/).filter((part) => part.trim().length > 20);

  if (byDoubleNewline.length >= 2 && byDoubleNewline.length <= 3) {
    return byDoubleNewline.map((part, index) => ({
      text: part.trim(),
      delayMs: index === 0 ? 0 : 2000 * index,
    }));
  }

  if (cleaned.length > 200) {
    const sentences = cleaned.match(/[^.!?]+[.!?]+/g) ?? [cleaned];

    if (sentences.length >= 2) {
      const mid = Math.ceil(sentences.length / 2);
      const first = sentences.slice(0, mid).join(' ').trim();
      const second = sentences.slice(mid).join(' ').trim();

      if (first.length > 20 && second.length > 20) {
        if (cleaned.length < 400 || maxParts < 3) {
          return [
            { text: first, delayMs: 0 },
            { text: second, delayMs: 2000 },
          ];
        }

        const thirdStart = Math.ceil(sentences.length * 0.66);
        const p1 = sentences.slice(0, Math.ceil(sentences.length / 3)).join(' ').trim();
        const p2 = sentences.slice(Math.ceil(sentences.length / 3), thirdStart).join(' ').trim();
        const p3 = sentences.slice(thirdStart).join(' ').trim();

        if (p1.length > 20 && p2.length > 20 && p3.length > 20) {
          return [
            { text: p1, delayMs: 0 },
            { text: p2, delayMs: 2000 },
            { text: p3, delayMs: 4000 },
          ];
        }
      }
    }
  }

  return [{ text: cleaned, delayMs: 0 }];
}

export function calculateTypingDelay(text: string): number {
  const CHARS_PER_SECOND = 40;
  const MIN_DELAY = 800;
  const MAX_DELAY = 3000;
  const delay = (text.length / CHARS_PER_SECOND) * 1000;
  return Math.min(MAX_DELAY, Math.max(MIN_DELAY, delay));
}
