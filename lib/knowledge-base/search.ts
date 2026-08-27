import { createClient } from '@supabase/supabase-js';
import { generateQueryEmbedding } from './embeddings';

const searchCache = new Map<string, { results: KBSearchResult[]; expiresAt: number }>();
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;

type BilingualTermRule = {
  pattern: string;
  query_ru: string;
  query_kk: string;
  variants?: string[];
};

const bilingualConfigCache = new Map<string, { termMap?: BilingualTermRule[]; expiresAt: number }>();

// Cache provider checks per-agent to avoid hitting kb_chunks on every search call
const providerCheckCache = new Map<string, { providers: Set<string | null>; expiresAt: number }>();

async function checkAndLogEmbeddingProviders(agentId: string): Promise<void> {
  const cached = providerCheckCache.get(agentId);
  if (cached && cached.expiresAt > Date.now()) return;

  const supabase = getAdminClient();
  try {
    const { data: providerRows, error: providerError } = await supabase.rpc(
      'get_embedding_providers_for_agent',
      { p_agent_id: agentId }
    );

    if (providerError) {
      return;
    }

    if (!Array.isArray(providerRows) || providerRows.length === 0) {
      providerCheckCache.set(agentId, { providers: new Set(), expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
      return;
    }

    const providers = new Set<string | null>();
    for (const row of providerRows) {
      const val = row?.provider;
      const normalized = (typeof val === 'string' && val.trim().length > 0) ? val.trim() : null;
      providers.add(normalized);
    }

    if (providers.size > 1) {
      const list = Array.from(providers).map((p) => (p === null ? 'null' : p));
      // eslint-disable-next-line no-console
      console.error(`[KB] Embedding provider mismatch for agent ${agentId}: ${list.join(', ')}`);
    }

    providerCheckCache.set(agentId, { providers, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
  } catch (e) {
    // Don't let provider check failures affect normal search flow
    return;
  }
}

function getCacheKey(agentId: string, query: string): string {
  return `${agentId}:${query.toLowerCase().trim()}`;
}

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

function fastBilingualMap(query: string, termMap?: BilingualTermRule[]): { query_ru: string; query_kk: string } {
  const lower = query.toLowerCase().trim();
  if (!lower) {
    return { query_ru: '', query_kk: '' };
  }

  if (!termMap || termMap.length === 0) {
    return { query_ru: lower, query_kk: lower };
  }

  for (const rule of termMap) {
    try {
      const re = new RegExp(rule.pattern, 'i');
      if (re.test(lower)) {
        return { query_ru: rule.query_ru, query_kk: rule.query_kk };
      }
    } catch (e) {
      // ignore invalid regex and continue
    }
  }

  return { query_ru: lower, query_kk: lower };
}

function buildFallbackBilingualQueries(query: string, termMap?: BilingualTermRule[]): { query_ru: string; query_kk: string } {
  return fastBilingualMap(query, termMap);
}

function buildExpandedSearchQueries(query: string, termMap?: BilingualTermRule[]): string[] {
  const normalizedQuery = query?.trim() ?? '';
  if (!normalizedQuery) return [];

  const variants = new Set<string>([normalizedQuery]);
  const lower = normalizedQuery.toLowerCase();

  if (!termMap || termMap.length === 0) {
    return Array.from(variants).filter(Boolean);
  }

  for (const rule of termMap) {
    try {
      const re = new RegExp(rule.pattern, 'i');
      if (re.test(lower)) {
        variants.add(rule.query_ru);
        variants.add(rule.query_kk);
        if (Array.isArray(rule.variants)) {
          for (const v of rule.variants) variants.add(v);
        }
      }
    } catch (e) {
      // ignore invalid regex
    }
  }

  return Array.from(variants).filter(Boolean);
}

function normalizeGeneratedBilingualQueries(originalQuery: string, queryRu: string, queryKk: string, termMap?: BilingualTermRule[]) {
  const normalizedRu = normalizeMetadataValue(queryRu) ?? originalQuery;
  const normalizedKk = normalizeMetadataValue(queryKk) ?? originalQuery;
  const lowerOriginal = originalQuery.toLowerCase();

  if (!termMap || termMap.length === 0) {
    return {
      query_ru: normalizedRu,
      query_kk: normalizedKk,
    };
  }

  for (const rule of termMap) {
    try {
      const re = new RegExp(rule.pattern, 'i');
      if (re.test(lowerOriginal)) {
        return { query_ru: rule.query_ru, query_kk: rule.query_kk };
      }
    } catch (e) {
      // ignore invalid regex
    }
  }

  return {
    query_ru: normalizedRu,
    query_kk: normalizedKk,
  };
}

function parseBilingualSearchQueries(text: string, fallbackQuery: string, termMap?: BilingualTermRule[]): { query_ru: string; query_kk: string } {
  const sanitized = sanitizeGeminiJsonResponse(text);
  if (!sanitized) {
    return buildFallbackBilingualQueries(fallbackQuery, termMap);
  }

  try {
    const parsed = JSON.parse(sanitized);
    const queryRu = normalizeMetadataValue(parsed?.query_ru) ?? '';
    const queryKk = normalizeMetadataValue(parsed?.query_kk) ?? '';
    if (queryRu || queryKk) {
      return normalizeGeneratedBilingualQueries(fallbackQuery, queryRu, queryKk, termMap);
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
      queryKkMatch?.[1] ?? '',
      termMap,
    );
  }

  const lines = sanitized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length >= 2) {
    return normalizeGeneratedBilingualQueries(fallbackQuery, lines[0] || '', lines[1] || '', termMap);
  }

  return buildFallbackBilingualQueries(fallbackQuery, termMap);
}

export async function generateBilingualSearchQueries(query: string): Promise<{ query_ru: string; query_kk: string }> {
  const normalizedQuery = query?.trim() ?? '';
  if (!normalizedQuery) {
    return { query_ru: '', query_kk: '' };
  }

  return fastBilingualMap(normalizedQuery);
}

function rerankChunks(chunks: KBSearchResult[], query: string): KBSearchResult[] {
  const queryWords = new Set(
    query.toLowerCase()
      .replace(/[^\w\sа-яәіңғүұқөһ]/gi, '')
      .split(/\s+/)
      .filter((word) => word.length > 3)
  );

  return chunks
    .map((chunk) => {
      const contentWords = new Set(
        chunk.content.toLowerCase()
          .replace(/[^\w\sа-яәіңғүұқөһ]/gi, '')
          .split(/\s+/)
      );

      const intersection = [...queryWords].filter((word) => contentWords.has(word)).length;
      const coverage = queryWords.size > 0 ? intersection / queryWords.size : 0;
      const rerankedScore = chunk.similarity + (coverage * 0.25);

      return { ...chunk, similarity: Math.min(rerankedScore, 1.0) };
    })
    .sort((a, b) => b.similarity - a.similarity);
}

async function searchKnowledgeBaseSingleQuery(
  agentId: string,
  queryVariant: string,
  topK = 15,
  threshold = 0.3,
  queryEmbeddingOverride: unknown | null = null,
  originalQuery?: string | null,
): Promise<KBSearchResult[]> {
  const supabase = getAdminClient();
  const queryEmbedding = queryEmbeddingOverride ?? await generateQueryEmbedding(originalQuery ?? queryVariant);

  // Fire-and-forget check of embedding providers for this agent (cached by TTL)
  // Do not await — this must not block the hot search path.
  void checkAndLogEmbeddingProviders(agentId).catch(() => { /* ignore errors */ });

  let data: any = null;
  try {
    const res = await supabase.rpc('search_knowledge_base', {
      p_agent_id: agentId,
      query_embedding: queryEmbedding,
      p_query_text: originalQuery ?? queryVariant,
      match_count: topK,
      similarity_threshold: threshold,
    });
    data = res.data;
    if (res.error) throw res.error;
  } catch (err: any) {
    const msg = String(err?.message ?? err?.error ?? err);
    const signatureError = /could not find the function|no matches were found|unknown parameter|unrecognized parameter|argument.*not found|invalid parameter/i;
    const shouldFallback = signatureError.test(msg);
    if (!shouldFallback) {
      // For non-signature errors (network, timeout, etc.) surface the error instead of silently falling back
      throw err;
    }

    console.warn('[KB] search RPC fallback without p_query_text due to signature/parameter mismatch:', msg);
    try {
      const res2 = await supabase.rpc('search_knowledge_base', {
        p_agent_id: agentId,
        query_embedding: queryEmbedding,
        match_count: topK,
        similarity_threshold: threshold,
      });
      data = res2.data;
      if (res2.error) throw res2.error;
    } catch (err2: any) {
      // If fallback also fails, rethrow with both messages attached
      const msg2 = err2 instanceof Error ? err2.message : String(err2?.error ?? err2);
      const combined = `${msg} || fallback error: ${msg2}`;
      const e = new Error(combined);
      throw e;
    }
  }

  const results = (data || []).map((row: any) => ({
    chunk_id: row.chunk_id,
    source_id: row.source_id,
    content: row.content,
    similarity: row.similarity,
    priority: row.priority,
    metadata: row.metadata || {},
    source_metadata: row.source_metadata || null,
  }));

  return rankKnowledgeBaseChunks(results, originalQuery ?? queryVariant);
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
  queryEmbeddingOverride: unknown | null = null,
): Promise<KBSearchResult[]> {
  const cacheKey = getCacheKey(agentId, query);
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    console.log('[KB] CACHE HIT', { query });
    return cached.results;
  }

  // load per-agent bilingual term map (cached briefly)
  let termMap: BilingualTermRule[] | undefined = undefined;
  const cfgCache = bilingualConfigCache.get(agentId);
  if (cfgCache && cfgCache.expiresAt > Date.now()) {
    termMap = cfgCache.termMap;
  } else {
    try {
      const supabase = getAdminClient();
      const { data, error } = await supabase.from('agents').select('search_config').eq('id', agentId).single();
      if (!error && data) {
        const cfg = data.search_config ?? {};
        if (Array.isArray(cfg?.bilingual_term_map)) {
          termMap = cfg.bilingual_term_map as BilingualTermRule[];
        }
      }
    } catch (e) {
      // ignore DB errors — treat as no term map
    }
    bilingualConfigCache.set(agentId, { termMap, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
  }

  const { query_ru, query_kk } = fastBilingualMap(query, termMap);

  const [ruResults, kkResults] = await Promise.all([
    searchKnowledgeBaseSingleQuery(agentId, query_ru, topK, threshold, queryEmbeddingOverride, query),
    searchKnowledgeBaseSingleQuery(agentId, query_kk, topK, threshold, queryEmbeddingOverride, query),
  ]);

  // Merge RU/KK results and ensure a global sort by similarity so the combined
  // list is globally ordered (avoids two internally-sorted lists being concatenated).
  let mergedResults = mergeSearchResults(ruResults, kkResults);
  mergedResults.sort((a, b) => b.similarity - a.similarity);
  const normalizedGrade = parseLeadGrade(leadGrade);

  let finalResults = normalizedGrade !== null
    ? mergedResults.filter((chunk) => isChunkAllowedForLead(chunk, normalizedGrade))
    : mergedResults;

  if (finalResults.length === 0) {
    finalResults = mergedResults;
  }

  const reranked = rerankChunks(finalResults, query);
  const ranked = rankKnowledgeBaseChunks(reranked, query);
  // Return the ranked list (sorted by rankingScore inside `rankKnowledgeBaseChunks`).
  // Do NOT override this with a pure similarity-only sort here — that would erase
  // the effects of keywordBonus and priorityBoost and cause a regression.
  searchCache.set(cacheKey, { results: ranked, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });

  return ranked;
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
  queryEmbeddingOverride: unknown | null = null,
): Promise<KnowledgeBaseRetrievalResult> {
  const primaryChunks = await searchKnowledgeBaseBilingual(agentId, query, topK, threshold, leadGrade, queryEmbeddingOverride);
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
