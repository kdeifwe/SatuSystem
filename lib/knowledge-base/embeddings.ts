import { GEMINI_EMBEDDING_MODEL, GEMINI_EMBEDDING_OUTPUT_DIMENSIONALITY } from '@/lib/server/ai/gemini-client';

const GEMINI_EMBED_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent`;

const BATCH_SIZE = 20; // Gemini allows batching; stay conservative
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;

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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    const res = await fetch(`${GEMINI_EMBED_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: GEMINI_EMBEDDING_OUTPUT_DIMENSIONALITY,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const embedding = normalizeEmbedding(data.embedding.values as number[]);
      console.log('[KB] Embedding generated, dimensions:', embedding.length);
      return embedding;
    }

    if (res.status === 404) {
      const body = await res.text();
      console.error(`Gemini embed model not found: ${GEMINI_EMBEDDING_MODEL} (${res.status})`, body);
      throw new Error(`Gemini embed model not found: ${GEMINI_EMBEDDING_MODEL}`);
    }

    if (res.status === 429 || res.status >= 500) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`Gemini embed attempt ${attempt + 1} failed (${res.status}), retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    throw new Error(`Gemini embed error: ${res.status} ${await res.text()}`);
  }

  throw new Error('Gemini embed: max retries exceeded');
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

    // Small delay between batches to be gentle on rate limits
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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    const res = await fetch(`${GEMINI_EMBED_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text: query }] },
        taskType: 'RETRIEVAL_QUERY',
        outputDimensionality: GEMINI_EMBEDDING_OUTPUT_DIMENSIONALITY,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const embedding = normalizeEmbedding(data.embedding.values as number[]);
      console.log('[KB] Query embedding generated, dimensions:', embedding.length);
      return embedding;
    }

    if (res.status === 404) {
      const body = await res.text();
      console.error(`Gemini query embed model not found: ${GEMINI_EMBEDDING_MODEL} (${res.status})`, body);
      throw new Error(`Gemini query embed model not found: ${GEMINI_EMBEDDING_MODEL}`);
    }

    if (res.status === 429 || res.status >= 500) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`Gemini query embed attempt ${attempt + 1} failed (${res.status}), retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    throw new Error(`Gemini query embed error: ${res.status}`);
  }

  throw new Error('Gemini query embed: max retries exceeded');
}