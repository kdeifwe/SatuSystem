import { createClient } from '@supabase/supabase-js';
import { generateQueryEmbedding } from './embeddings';
import { llmClient, type LLMMessage } from '../server/ai/llm-client';
import { GEMINI_PROMPT_MODEL } from '../server/ai/gemini-client';

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export type KBMetadata = {
  tag?: string;
  [key: string]: unknown;
};

export interface KBSearchResult {
  chunk_id: string;
  source_id: string;
  content: string;
  similarity: number;
  priority: string;
  metadata: KBMetadata;
  source_metadata?: KBMetadata | null;
}

function normalizeMetadataValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return null;
}

function parseLeadGrade(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value) : null;
  }

  if (typeof value === 'string') {
    const match = value.match(/\d+/);
    if (!match) return null;
    return Number.parseInt(match[0], 10);
  }

  return null;
}

export function resolveChunkGrades(
  chunkMetadata: Record<string, unknown> | null | undefined,
  sourceMetadata?: Record<string, unknown> | null,
): number[] | null {
  const chunkTag = normalizeMetadataValue(chunkMetadata?.tag);
  const sourceTag = normalizeMetadataValue(sourceMetadata?.tag);
  const rawTag = chunkTag ?? sourceTag;
  if (!rawTag) return null;

  const matches = Array.from(rawTag.matchAll(/\d+/g)).map((match) => Number.parseInt(match[0], 10));
  const uniqueGrades = Array.from(new Set(matches.filter((value) => Number.isFinite(value))));
  if (uniqueGrades.length === 0) return null;
  return uniqueGrades.sort((a, b) => a - b);
}

function isChunkAllowedForLead(chunk: KBSearchResult, leadGrade: number | null): boolean {
  if (leadGrade === null) return true;
  const chunkGrades = resolveChunkGrades(chunk.metadata, chunk.source_metadata ?? null);
  return chunkGrades === null || chunkGrades.includes(leadGrade);
}

function mergeSearchResults(primaryChunks: KBSearchResult[], secondaryChunks: KBSearchResult[]): KBSearchResult[] {
  const merged = new Map<string, KBSearchResult>();

  for (const chunk of [...primaryChunks, ...secondaryChunks]) {
    const existing = merged.get(chunk.chunk_id);
    if (!existing || chunk.similarity > existing.similarity) {
      merged.set(chunk.chunk_id, chunk);
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.similarity - a.similarity);
}

function extractTextFromGeminiResponse(data: any): string {
  const candidate = data?.candidates?.[0];
  if (!candidate) return '';
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  return parts
    .map((part: any) => typeof part?.text === 'string' ? part.text : '')
    .join('')
    .trim();
}

function sanitizeGeminiJsonResponse(text: string): string {
  let cleaned = String(text)
    .replace(/```(?:json)?/gi, '')
    .replace(/[\u2018\u2019\u201c\u201d]/g, '"')
    .trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  return cleaned;
}

function buildFallbackBilingualQueries(query: string): { query_ru: string; query_kk: string } {
  const normalizedQuery = query?.trim() ?? '';
  const queryRu = normalizedQuery || '';
  const lower = normalizedQuery.toLowerCase();

  let queryKk = normalizedQuery;
  if (/(сколько|стоимость|цена|стоит)/i.test(lower) && /(обучение|учеба|учёба)/i.test(lower)) {
    queryKk = 'Оқу құны';
  } else if (/(срок|длительность|длится|длиться|канша уакыт|ұзақты|месяц|month|months|ай)/i.test(lower)) {
    queryKk = 'Оқу ұзақтығы';
  } else if (/(предмет|предметы|предметов|пән|пәндер|subject|subjects)/i.test(lower)) {
    queryKk = 'Пәндер';
  } else if (/(зарегистр|регистрация|тіркел)/i.test(lower)) {
    queryKk = 'Тіркелу';
  } else if (/онлайн/i.test(lower)) {
    queryKk = 'Онлайн формат';
  } else if (/smart/i.test(lower)) {
    queryKk = 'SMART бағдарламасы';
  } else if (/когда|начинаются|начинается/i.test(lower)) {
    queryKk = 'Қашан басталады';
  } else if (/как/i.test(lower)) {
    queryKk = 'Қалай';
  }

  return { query_ru: queryRu, query_kk: queryKk || queryRu };
}

function buildExpandedSearchQueries(query: string): string[] {
  const normalizedQuery = query?.trim() ?? '';
  if (!normalizedQuery) return [];

  const variants = new Set<string>([normalizedQuery]);
  const lower = normalizedQuery.toLowerCase();

  if (/(срок|длительность|длится|длиться|канша уакыт|ұзақты|месяц|month|months|ай)/i.test(lower)) {
    variants.add('срок обучения');
    variants.add('оқу ұзақтығы');
    variants.add('длительность курса');
    variants.add('курс ұзақтығы');
  }

  if (/(стоимость|цена|стоит|құны|fee|price)/i.test(lower)) {
    variants.add('стоимость обучения');
    variants.add('оқу құны');
    variants.add('цена курса');
  }

  if (/(предмет|предметы|пән|пәндер|subject|subjects)/i.test(lower)) {
    variants.add('предметы курса');
    variants.add('қай пәндер');
  }

  return Array.from(variants).filter(Boolean);
}

function normalizeGeneratedBilingualQueries(originalQuery: string, queryRu: string, queryKk: string) {
  const normalizedRu = normalizeMetadataValue(queryRu) ?? originalQuery;
  const normalizedKk = normalizeMetadataValue(queryKk) ?? originalQuery;
  const lowerOriginal = originalQuery.toLowerCase();

  let improvedRu = normalizedRu;
  let improvedKk = normalizedKk;

  if (/(сколько|стоимость|цена|стоит)/i.test(lowerOriginal) && /(обучение|учеба|учёба)/i.test(lowerOriginal)) {
    improvedRu = 'Стоимость обучения';
    improvedKk = 'Оқу құны';
  } else if (/(срок|длительность|длится|длиться)/i.test(lowerOriginal)) {
    improvedRu = 'Срок обучения';
    improvedKk = 'Оқу ұзақтығы';
  } else if (/(предмет|предметы|предметов|subjects)/i.test(lowerOriginal)) {
    improvedRu = 'Изучаемые предметы';
    improvedKk = 'Қай пәндер';
  } else if (/(зарегистр|регистрация|тіркел|join|record)/i.test(lowerOriginal)) {
    improvedRu = 'Регистрация на курс';
    improvedKk = 'Курсқа тіркелу';
  } else if (/онлайн/i.test(lowerOriginal)) {
    improvedRu = 'Онлайн формат обучения';
    improvedKk = 'Онлайн оқу';
  } else if (/smart|программа/i.test(lowerOriginal)) {
    improvedRu = 'Программа SMART';
    improvedKk = 'SMART бағдарламасы';
  } else if (/(когда|начинаются|начинается)/i.test(lowerOriginal)) {
    improvedRu = 'Начало занятий';
    improvedKk = 'Қашан басталады';
  }

  return {
    query_ru: improvedRu,
    query_kk: improvedKk,
  };
}

function parseBilingualSearchQueries(text: string, fallbackQuery: string): { query_ru: string; query_kk: string } {
  const sanitized = sanitizeGeminiJsonResponse(text);
  if (!sanitized) {
    return buildFallbackBilingualQueries(fallbackQuery);
  }

  try {
    const parsed = JSON.parse(sanitized);
    const queryRu = normalizeMetadataValue(parsed?.query_ru) ?? '';
    const queryKk = normalizeMetadataValue(parsed?.query_kk) ?? '';
    if (queryRu || queryKk) {
      return normalizeGeneratedBilingualQueries(fallbackQuery, queryRu, queryKk);
    }
  } catch {
    // continue with line-based parsing
  }

  const queryRuMatch = sanitized.match(/"query_ru"\s*:\s*"([^"]*)"/i);
  const queryKkMatch = sanitized.match(/"query_kk"\s*:\s*"([^"]*)"/i);
  if (queryRuMatch || queryKkMatch) {
    return normalizeGeneratedBilingualQueries(
      fallbackQuery,
      queryRuMatch?.[1] ?? '',
      queryKkMatch?.[1] ?? ''
    );
  }

  const lines = sanitized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length >= 2) {
    return normalizeGeneratedBilingualQueries(fallbackQuery, lines[0] || '', lines[1] || '');
  }

  return buildFallbackBilingualQueries(fallbackQuery);
}

export async function generateBilingualSearchQueries(query: string): Promise<{ query_ru: string; query_kk: string }> {
  const normalizedQuery = query?.trim() ?? '';
  if (!normalizedQuery) {
    return { query_ru: '', query_kk: '' };
  }

  const prompt = `Сгенерируй ровно две строки без лишнего текста.
Первая строка — короткий естественный русский поисковый запрос.
Вторая строка — короткий естественный казахский поисковый запрос.
Обе строки должны быть короткими, поисковыми и 2–6 слов.
Не делай дословный перевод с русского, особенно для казахского варианта.
Пиши как носитель языка, а не как кальку с русского.
Для казахского варианта лучше использовать короткую естественную фразу, а не одно слово.
Если есть термины вроде SMART, Junior, online, registration, duration, fee, subjects, сохраняй их в естественной форме.

Примеры:
- "Сколько стоит обучение?" -> "Стоимость обучения"
- "Какие предметы изучают?" -> "Қай пәндер оқытылады?"
- "Как зарегистрироваться?" -> "Тіркелу қалай болады?"
- "Какой срок обучения?" -> "Оқу ұзақтығы"

Входная фраза: ${normalizedQuery}`;

  try {
    const messages: LLMMessage[] = [
      { role: 'system', content: 'Формируй два коротких поисковых запросов для векторного поиска: естественный русский и естественный казахский. Не делай дословный перевод с русского, особенно для казахского варианта.' },
      { role: 'user', content: prompt },
    ];

    const llmResponse = await llmClient.generate({
      model: GEMINI_PROMPT_MODEL,
      messages,
      temperature: 0.0,
      maxTokens: 240,
    });

    const text = llmResponse.text ?? '';
    if (!text) {
      const fallback = buildFallbackBilingualQueries(normalizedQuery);
      return { query_ru: fallback.query_ru, query_kk: fallback.query_kk };
    }

    const parsed = parseBilingualSearchQueries(text, normalizedQuery);
    const queryRu = normalizeMetadataValue(parsed.query_ru) ?? normalizedQuery;
    const queryKk = normalizeMetadataValue(parsed.query_kk) ?? normalizedQuery;
    return { query_ru: queryRu, query_kk: queryKk };
  } catch (error) {
    console.warn('[KB] Failed to generate bilingual search queries, using deterministic fallback', error);
    const fallback = buildFallbackBilingualQueries(normalizedQuery);
    return { query_ru: fallback.query_ru, query_kk: fallback.query_kk };
  }
}

async function searchKnowledgeBaseSingleQuery(
  agentId: string,
  query: string,
  topK = 15,
  threshold = 0.3,
): Promise<KBSearchResult[]> {
  const supabase = getAdminClient();
  const queryEmbedding = await generateQueryEmbedding(query);

  const { data, error } = await supabase.rpc('search_knowledge_base', {
    p_agent_id: agentId,
    query_embedding: queryEmbedding,
    match_count: topK,
    similarity_threshold: threshold,
  });

  if (error) throw error;

  const results = (data || []).map((row: any) => ({
    chunk_id: row.chunk_id,
    source_id: row.source_id,
    content: row.content,
    similarity: row.similarity,
    priority: row.priority,
    metadata: row.metadata || {},
    source_metadata: row.source_metadata || null,
  }));

  return rankKnowledgeBaseChunks(results, query);
}

export async function searchKnowledgeBase(
  agentId: string,
  query: string,
  topK = 15,
  threshold = 0.3,
): Promise<KBSearchResult[]> {
  return searchKnowledgeBaseSingleQuery(agentId, query, topK, threshold);
}

export async function searchKnowledgeBaseBilingual(
  agentId: string,
  query: string,
  topK = 15,
  threshold = 0.3,
  leadGrade: number | string | null = null,
): Promise<KBSearchResult[]> {
  const normalizedGrade = parseLeadGrade(leadGrade);
  const expandedQueries = buildExpandedSearchQueries(query);
  const allResults: KBSearchResult[] = [];

  for (const candidateQuery of expandedQueries) {
    const { query_ru, query_kk } = await generateBilingualSearchQueries(candidateQuery);
    const [ruResults, kkResults] = await Promise.all([
      searchKnowledgeBaseSingleQuery(agentId, query_ru, topK, threshold),
      searchKnowledgeBaseSingleQuery(agentId, query_kk, topK, threshold),
    ]);
    allResults.push(...mergeSearchResults(ruResults, kkResults));
  }

  const mergedResults = mergeSearchResults(allResults, []);
  if (normalizedGrade === null) {
    return rankKnowledgeBaseChunks(mergedResults, query);
  }

  const filtered = mergedResults.filter((chunk) => isChunkAllowedForLead(chunk, normalizedGrade));
  if (filtered.length > 0) {
    return rankKnowledgeBaseChunks(filtered, query);
  }

  return rankKnowledgeBaseChunks(mergedResults, query);
}

export interface LinkedKBChunkResult {
  id: string;
  content: string;
  similarity: number;
  priority: string;
  metadata: KBMetadata;
  link_type: string;
}

export interface KnowledgeBaseRetrievalResult {
  primaryChunks: KBSearchResult[];
  linkedChunks: LinkedKBChunkResult[];
  contextText: string;
}

function getNormalizedMetadataValue(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  if (typeof value === 'string' && value.trim()) {
    return value.trim().toLowerCase();
  }
  return null;
}

function getChunkPriorityBoost(chunk: KBSearchResult): number {
  const metadata = chunk.metadata ?? {};
  const priority = typeof chunk.priority === 'string' && chunk.priority.trim() ? chunk.priority.trim().toLowerCase() : null;
  const type = getNormalizedMetadataValue(metadata, 'type') ?? getNormalizedMetadataValue(metadata, 'category');
  const sourceType = getNormalizedMetadataValue(metadata, 'source_type');

  let boost = 0;

  if (priority === 'structured' || priority === 'qa') {
    boost += 0.18;
  }

  if (type === 'product' || type === 'faq') {
    boost += 0.14;
  } else if (type === 'procedure' || type === 'contact') {
    boost += 0.08;
  }

  if (sourceType === 'instagram') {
    boost -= 0.16;
  }

  if (!type || type === 'other') {
    boost -= 0.06;
  }

  return boost;
}

export function rankKnowledgeBaseChunks(chunks: KBSearchResult[], query = ''): KBSearchResult[] {
  const queryWords = query.toLowerCase().split(/\s+/).filter((word) => word.length > 2);

  return [...chunks]
    .map((chunk) => {
      const content = chunk.content.toLowerCase();
      const keywordBonus = queryWords.filter((word) => content.includes(word)).length * 0.05;
      const rankingScore = chunk.similarity + keywordBonus + getChunkPriorityBoost(chunk);
      return { chunk, rankingScore };
    })
    .sort((a, b) => {
      if (b.rankingScore !== a.rankingScore) {
        return b.rankingScore - a.rankingScore;
      }
      return b.chunk.similarity - a.chunk.similarity;
    })
    .map(({ chunk }) => chunk);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function buildContextText(primaryChunks: KBSearchResult[], linkedChunks: LinkedKBChunkResult[], maxTokens = 2000): string {
  const sections: string[] = [];
  const primarySections = primaryChunks.map((chunk, index) => {
    const relevancePercent = Math.round(chunk.similarity * 100);
    const metadataType = getNormalizedMetadataValue(chunk.metadata, 'type') ?? getNormalizedMetadataValue(chunk.metadata, 'category') ?? 'unknown';
    const sourceType = getNormalizedMetadataValue(chunk.metadata, 'source_type') ?? 'unknown';
    const priority = chunk.priority || 'unknown';
    return `${index + 1}. [Релевантность: ${relevancePercent}%] [type: ${metadataType}] [priority: ${priority}] [source: ${sourceType}]\n${chunk.content}`;
  });
  sections.push(...primarySections);

  const sortedLinked = [...linkedChunks].sort((a, b) => b.similarity - a.similarity);
  const linkedSections: string[] = [];
  let usedTokens = sections.join('\n\n').length > 0 ? estimateTokens(sections.join('\n\n')) : 0;

  for (const chunk of sortedLinked) {
    const section = `Связанный фрагмент [${chunk.link_type} • ${Math.round(chunk.similarity * 100)}%]:\n${chunk.content}`;
    const sectionTokens = estimateTokens(section);
    if (usedTokens + sectionTokens > maxTokens) {
      break;
    }
    linkedSections.push(section);
    usedTokens += sectionTokens;
  }

  if (linkedSections.length > 0) {
    sections.push('');
    sections.push('Связанные чанки:');
    sections.push(...linkedSections);
  }

  return sections.join('\n\n');
}

export async function searchKnowledgeBaseWithLinks(
  agentId: string,
  query: string,
  topK = 15,
  threshold = 0.3,
  leadGrade: number | string | null = null,
): Promise<KnowledgeBaseRetrievalResult> {
  const primaryChunks = await searchKnowledgeBaseBilingual(agentId, query, topK, threshold, leadGrade);
  const linkedChunkIds = primaryChunks.map((chunk) => chunk.chunk_id);
  const linkedChunks = await getLinkedKBChunks(linkedChunkIds);

  return {
    primaryChunks,
    linkedChunks,
    contextText: buildContextText(primaryChunks, linkedChunks),
  };
}

export async function getLinkedKBChunks(chunkIds: string[]): Promise<LinkedKBChunkResult[]> {
  if (!chunkIds.length) return [];

  const supabase = getAdminClient();
  // TODO: verify that public.get_linked_kb_chunks exists in Supabase and is applied from DB migrations or manual SQL.
  const { data, error } = await supabase.rpc('get_linked_kb_chunks', { p_chunk_ids: chunkIds });
  if (error) throw error;

  return (data || []).map((row: any) => ({
    id: row.id,
    content: row.content,
    similarity: row.similarity,
    priority: row.priority,
    metadata: row.metadata || {},
    link_type: row.link_type,
  }));
}

export function formatChunksForPrompt(chunks: KBSearchResult[]): string {
  if (!chunks || chunks.length === 0) {
    return 'Информация по данному вопросу в базе знаний не найдена.';
  }

  const rankedChunks = rankKnowledgeBaseChunks(chunks);

  return rankedChunks
    .map((chunk, index) => {
      const relevancePercent = Math.round(chunk.similarity * 100);
      const metadataType = getNormalizedMetadataValue(chunk.metadata, 'type') ?? getNormalizedMetadataValue(chunk.metadata, 'category') ?? 'unknown';
      const sourceType = getNormalizedMetadataValue(chunk.metadata, 'source_type') ?? 'unknown';
      const priority = chunk.priority || 'unknown';
      return `${index + 1}. [Релевантность: ${relevancePercent}%] [type: ${metadataType}] [priority: ${priority}] [source: ${sourceType}]\n${chunk.content}`;
    })
    .join('\n\n');
}
