import { buildCategoriesSummary, buildCategorizationPrompt, normalizeCategory, type KBCategory } from './categories';

const BATCH_SIZE = 10;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function categorizeChunks(chunks: string[]): Promise<KBCategory[]> {
  if (!chunks.length) return [];

  const categories: KBCategory[] = [];
  const chunkBatches = [] as string[][];
  for (let index = 0; index < chunks.length; index += BATCH_SIZE) {
    chunkBatches.push(chunks.slice(index, index + BATCH_SIZE));
  }

  for (const [index, batch] of chunkBatches.entries()) {
    const batchCategories = await categorizeBatch(batch);
    categories.push(...batchCategories);
    if (index < chunkBatches.length - 1) {
      await delay(400);
    }
  }

  return categories;
}

export async function buildSummaryForCategories(categories: KBCategory[]) {
  return buildCategoriesSummary(categories);
}

async function categorizeBatch(chunks: string[]): Promise<KBCategory[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return chunks.map(() => 'other');
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: buildCategorizationPrompt(chunks) }],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 256,
      },
    }),
  });

  if (!response.ok) {
    console.error('[knowledge-categorizer] Gemini request failed', await response.text());
    return chunks.map(() => 'other');
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
  const normalized = text
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();

  try {
    const parsed = JSON.parse(normalized);
    if (!Array.isArray(parsed)) {
      return chunks.map(() => 'other');
    }
    return parsed.map((value) => normalizeCategory(value));
  } catch (error) {
    console.error('[knowledge-categorizer] Could not parse Gemini response', error, normalized);
    return chunks.map(() => 'other');
  }
}
