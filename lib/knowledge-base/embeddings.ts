import {
  GEMINI_API_BASE,
  GEMINI_EMBEDDING_MODEL,
  GEMINI_EMBEDDING_OUTPUT_DIMENSIONALITY,
} from '@/lib/server/ai/gemini-client';

const BATCH_SIZE = 20; // Gemini allows batching; stay conservative
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;

function getEmbeddingModelCandidates(): string[] {
  const configured = process.env.GEMINI_EMBEDDING_MODEL?.trim();
  return Array.from(new Set([configured, GEMINI_EMBEDDING_MODEL, 'gemini-embedding-001', 'gemini-embedding-2-preview'].filter(Boolean) as string[]));
}

async function requestEmbedding(text: string, taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY', model: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const res = await fetch(`${GEMINI_API_BASE}/models/${model}:embedContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: GEMINI_EMBEDDING_OUTPUT_DIMENSIONALITY,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini embed error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const embedding = normalizeEmbedding(data.embedding.values as number[]);
  console.log('[KB] Embedding generated with model:', model, 'dimensions:', embedding.length);
  return embedding;
}

export interface EmbeddingResult {
  embedding: number[];
  content: string;
}

/**
 * Generates a single embedding. Retries on 429/5xx with exponential backoff.
 */
function normalizeEmbedding(values: number[]): number[] {
  const length = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!length || length === 0) return values;
  return values.map((value) => value / length);
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const models = getEmbeddingModelCandidates();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    lastError = null;

    for (const model of models) {
      try {
        return await requestEmbedding(text, 'RETRIEVAL_DOCUMENT', model);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastError = error instanceof Error ? error : new Error(message);

        if (message.includes('404') || message.includes('400')) {
          console.warn(`[KB] Embedding model ${model} failed, trying fallback`, message);
          continue;
        }

        throw error;
      }
    }

    if (lastError) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`Gemini embed attempt ${attempt + 1} failed, retrying in ${delay}ms`, lastError.message);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error(`Gemini embed: max retries exceeded${lastError ? `: ${lastError.message}` : ''}`);
}

/**
 * Generates embeddings for a batch of texts.
 * Processes in batches to respect rate limits.
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<EmbeddingResult[]> {
  const results: EmbeddingResult[] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const embeddings = await Promise.all(batch.map((t) => generateEmbedding(t)));
    results.push(...batch.map((content, j) => ({ content, embedding: embeddings[j] })));

    if (i + BATCH_SIZE < texts.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return results;
}

/**
 * Generates an embedding for semantic search (uses RETRIEVAL_QUERY task type).
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  const models = getEmbeddingModelCandidates();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    lastError = null;

    for (const model of models) {
      try {
        return await requestEmbedding(query, 'RETRIEVAL_QUERY', model);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastError = error instanceof Error ? error : new Error(message);

        if (message.includes('404') || message.includes('400')) {
          console.warn(`[KB] Query embedding model ${model} failed, trying fallback`, message);
          continue;
        }

        throw error;
      }
    }

    if (lastError) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`Gemini query embed attempt ${attempt + 1} failed, retrying in ${delay}ms`, lastError.message);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error(`Gemini query embed: max retries exceeded${lastError ? `: ${lastError.message}` : ''}`);
}
