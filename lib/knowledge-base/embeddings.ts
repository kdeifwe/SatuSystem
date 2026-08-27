import { GEMINI_EMBEDDING_MODEL, GEMINI_EMBEDDING_OUTPUT_DIMENSIONALITY } from '@/lib/server/ai/gemini-client';

const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';
const OPENAI_EMBEDDING_DIMENSIONS = Number(process.env.OPENAI_EMBEDDING_DIMENSIONS ?? 768);

const GEMINI_EMBED_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent`;

const BATCH_SIZE = 20; // Gemini allows batching; stay conservative
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;

// Require explicit provider selection to avoid silent fallback by presence of API keys.
const EMBEDDINGS_PROVIDER = (process.env.EMBEDDINGS_PROVIDER ?? '').toLowerCase();
if (!EMBEDDINGS_PROVIDER) {
  throw new Error('EMBEDDINGS_PROVIDER environment variable is required and must be "gemini" or "openai"');
}
if (EMBEDDINGS_PROVIDER !== 'openai' && EMBEDDINGS_PROVIDER !== 'gemini') {
  throw new Error('EMBEDDINGS_PROVIDER must be either "gemini" or "openai"');
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

async function generateOpenAIEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: text,
      model: OPENAI_EMBEDDING_MODEL,
      dimensions: OPENAI_EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI embed error: ${response.status} ${body}`);
  }

  const data = await response.json() as { data?: Array<{ embedding?: number[] }> };
  const embedding = data.data?.[0]?.embedding;
  if (!embedding) throw new Error('OpenAI embed response missing embedding data');

  console.log('[KB] OpenAI embedding generated, dimensions:', embedding.length);
  return normalizeEmbedding(embedding);
}

export async function generateEmbedding(text: string): Promise<number[]> {
  if (EMBEDDINGS_PROVIDER === 'openai') {
    return generateOpenAIEmbedding(text);
  }

  if (EMBEDDINGS_PROVIDER === 'gemini') {
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

  throw new Error(`Unsupported EMBEDDINGS_PROVIDER: ${EMBEDDINGS_PROVIDER}`);
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
  if (EMBEDDINGS_PROVIDER === 'openai') {
    return generateOpenAIEmbedding(query);
  }

  if (EMBEDDINGS_PROVIDER === 'gemini') {
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

  throw new Error(`Unsupported EMBEDDINGS_PROVIDER: ${EMBEDDINGS_PROVIDER}`);
}