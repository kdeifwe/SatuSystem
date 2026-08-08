import { buildCategoriesSummary, buildCategorizationPrompt, normalizeCategory, type KBCategory } from './categories.ts';
import { llmClient, type LLMMessage } from '../../server/ai/llm-client.ts';
import { createAdminClient } from '../../supabase/admin.ts';

const BATCH_SIZE = 10;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? process.env.GEMINI_PROMPT_MODEL ?? 'gemini-2.5-flash';

export interface CategorizationResult {
  category: KBCategory;
  fallbackUsed: boolean;
  error?: string;
}

export interface CategorizeChunksOptions {
  logToAiCallLogs?: boolean;
  sourceId?: string;
  agentId?: string;
  conversationId?: string | null;
  sourceType?: string;
  operationName?: string;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function categorizeChunks(chunks: string[], options: CategorizeChunksOptions = {}): Promise<KBCategory[]> {
  return (await categorizeChunksDetailed(chunks, options)).map((entry) => entry.category);
}

export function parseGeminiCategorizationText(rawText: string, expectedCount: number): KBCategory[] | null {
  const trimmed = String(rawText ?? '').trim();
  if (!trimmed) return null;

  const normalized = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!normalized) return null;

  try {
    const parsed = JSON.parse(normalized);
    if (Array.isArray(parsed)) {
      const categories = parsed.map((value) => normalizeCategory(value));
      return Array.from({ length: expectedCount }, (_, index) => categories[index] ?? 'other');
    }

    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).categories)) {
      const categories = ((parsed as Record<string, unknown>).categories as unknown[]).map((value) => normalizeCategory(value));
      return Array.from({ length: expectedCount }, (_, index) => categories[index] ?? 'other');
    }
  } catch {
    // fall through to best-effort extraction below
  }

  const quotedMatches = [...normalized.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const bareMatches = [...normalized.matchAll(/\b(product|faq|procedure|contact|file|other|qa|questions|questions_answers|contacts)\b/gi)].map((match) => match[1]);
  const extracted = [...quotedMatches, ...bareMatches]
    .map((value) => normalizeCategory(value))
    .filter((value): value is KBCategory => Boolean(value));

  if (extracted.length) {
    return Array.from({ length: expectedCount }, (_, index) => extracted[index] ?? 'other');
  }

  return null;
}

export async function categorizeChunksDetailed(chunks: string[], options: CategorizeChunksOptions = {}): Promise<CategorizationResult[]> {
  if (!chunks.length) return [];

  const results: CategorizationResult[] = [];
  const chunkBatches = [] as string[][];
  for (let index = 0; index < chunks.length; index += BATCH_SIZE) {
    chunkBatches.push(chunks.slice(index, index + BATCH_SIZE));
  }

  for (const [index, batch] of chunkBatches.entries()) {
    const batchResults = await categorizeBatchDetailed(batch, options);
    results.push(...batchResults);
    if (index < chunkBatches.length - 1) {
      await delay(400);
    }
  }

  return results;
}

export async function buildSummaryForCategories(categories: KBCategory[]) {
  return buildCategoriesSummary(categories);
}

async function categorizeBatchDetailed(chunks: string[], options: CategorizeChunksOptions = {}): Promise<CategorizationResult[]> {
  const requestPayload = {
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
  };

  try {
    const messages: LLMMessage[] = [
      { role: 'user', content: buildCategorizationPrompt(chunks) },
    ];

    const llmResponse = await llmClient.generate({
      model: GEMINI_MODEL,
      messages,
      temperature: 0.1,
      maxTokens: 256,
    });

    const text = llmResponse.text ?? '[]';
    const categories = parseGeminiCategorizationText(text, chunks.length);

    if (categories) {
      await logCategorizationCall(options, requestPayload, {
        status: 'ok',
        categorization_count: categories.length,
        categories,
        fallback_used: false,
      });
      return categories.map((category) => ({ category, fallbackUsed: false }));
    }

    const reason = 'gemini_response_not_array';
    console.error('[knowledge-categorizer] Could not parse LLM response', { text });
    await logCategorizationCall(options, requestPayload, {
      status: 'fallback',
      fallback_reason: reason,
      categories: chunks.map(() => 'other'),
      fallback_used: true,
    });
    return chunks.map(() => ({ category: 'other', fallbackUsed: true, error: reason }));
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown_gemini_error';
    console.error('[knowledge-categorizer] Gemini request failed', error);
    await logCategorizationCall(options, requestPayload, {
      status: 'fallback',
      fallback_reason: reason,
      categories: chunks.map(() => 'other'),
      fallback_used: true,
    });
    return chunks.map(() => ({ category: 'other', fallbackUsed: true, error: reason }));
  }
}

async function logCategorizationCall(options: CategorizeChunksOptions, requestPayload: Record<string, unknown>, response: Record<string, unknown>) {
  if (!options.logToAiCallLogs) return;

  try {
    const admin = createAdminClient();
    await admin.from('ai_call_logs').insert({
      conversation_id: options.conversationId ?? null,
      request: {
        action: options.operationName ?? 'knowledge_categorization',
        source_id: options.sourceId ?? null,
        agent_id: options.agentId ?? null,
        source_type: options.sourceType ?? null,
        chunk_count: Array.isArray(requestPayload.contents) ? requestPayload.contents.length : null,
      },
      response,
    });
  } catch (error) {
    console.warn('[knowledge-categorizer] Failed to persist categorization log', error);
  }
}
