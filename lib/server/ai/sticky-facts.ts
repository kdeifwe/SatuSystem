export type StickyFact = {
  chunkId: string;
  content: string;
  similarity: number;
  addedAtMessageId: string | null;
  addedAtTs?: number;
};

export function normalizeStickyFacts(existingStickyFacts: unknown, ttlMs = 6 * 60 * 60 * 1000): StickyFact[] {
  if (!Array.isArray(existingStickyFacts)) return [];

  return existingStickyFacts.filter((fact) => {
    if (!fact || typeof (fact as any).chunkId !== 'string' || typeof (fact as any).content !== 'string') {
      return false;
    }
    if (typeof (fact as any).addedAtTs === 'number' && Date.now() - (fact as any).addedAtTs > ttlMs) {
      return false;
    }
    return true;
  }) as StickyFact[];
}

export function buildStickyFactsFromChunks(
  existingStickyFacts: unknown,
  chunks: Array<{ chunk_id: string; content: string; similarity: number }>,
  persistedUserMessageId: string | null | undefined,
  options: { similarityGate?: number; max?: number; ttlMs?: number } = {},
) {
  const similarityGate = options.similarityGate ?? 0.6;
  const max = options.max ?? 5;
  const ttlMs = options.ttlMs ?? 6 * 60 * 60 * 1000;

  const normalized = normalizeStickyFacts(existingStickyFacts, ttlMs);
  const existingIds = new Set(normalized.map((fact) => fact.chunkId));

  const additions: StickyFact[] = chunks
    .filter((chunk) => typeof chunk?.chunk_id === 'string' && typeof chunk?.content === 'string' && typeof chunk?.similarity === 'number')
    .filter((chunk) => chunk.similarity >= similarityGate)
    .filter((chunk) => !existingIds.has(chunk.chunk_id))
    .map((chunk) => ({
      chunkId: chunk.chunk_id,
      content: chunk.content,
      similarity: chunk.similarity,
      addedAtMessageId: persistedUserMessageId ?? null,
      addedAtTs: Date.now(),
    }));

  return {
    stickyFacts: [...normalized, ...additions].slice(-max),
    addedCount: additions.length,
  };
}

export function buildStickyFactsContextMessage(stickyFacts: StickyFact[]) {
  if (!stickyFacts.length) return null;

  const stickyFactsText = stickyFacts
    .map((fact, index) => `${index + 1}. ${fact.content}`)
    .join('\n\n');

  return `Ранее в этом диалоге уже были надёжно подтверждены следующие факты. Используй их напрямую, если клиент спрашивает то же самое другими словами — не нужно снова искать или говорить "уточню":\n${stickyFactsText}`;
}
