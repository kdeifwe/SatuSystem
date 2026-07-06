import { createClient } from '@supabase/supabase-js';
import { generateQueryEmbedding } from './embeddings';

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export interface KBSearchResult {
  chunk_id: string;
  source_id: string;
  content: string;
  similarity: number;
  priority: string;
  metadata: Record<string, unknown>;
}

export interface LinkedKBChunkResult {
  id: string;
  content: string;
  similarity: number;
  priority: string;
  metadata: Record<string, unknown>;
  link_type: string;
}

export interface KnowledgeBaseRetrievalResult {
  primaryChunks: KBSearchResult[];
  linkedChunks: LinkedKBChunkResult[];
  contextText: string;
}

function rerankWithKeywords(chunks: KBSearchResult[], query: string): KBSearchResult[] {
  const queryWords = query.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  return chunks
    .map((chunk) => {
      const content = chunk.content.toLowerCase();
      const keywordBonus = queryWords.filter((word) => content.includes(word)).length * 0.05;
      return { ...chunk, similarity: Math.min(1, chunk.similarity + keywordBonus) };
    })
    .sort((a, b) => b.similarity - a.similarity);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function buildContextText(primaryChunks: KBSearchResult[], linkedChunks: LinkedKBChunkResult[], maxTokens = 2000): string {
  const sections: string[] = [];
  const primarySections = primaryChunks.map((chunk, index) => {
    const relevancePercent = Math.round(chunk.similarity * 100);
    return `${index + 1}. [Релевантность: ${relevancePercent}%]\n${chunk.content}`;
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

export async function searchKnowledgeBase(
  agentId: string,
  query: string,
  topK = 10,
  threshold = 0.3
): Promise<KBSearchResult[]> {
  const supabase = getAdminClient();

  try {
    const queryEmbedding = await generateQueryEmbedding(query);

    // TODO: verify that public.search_knowledge_base exists in Supabase and is applied from DB migrations or manual SQL.
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
    }));

    return rerankWithKeywords(results, query);
  } catch (error) {
    console.error('Knowledge base search error:', error);
    return [];
  }
}

export async function searchKnowledgeBaseWithLinks(
  agentId: string,
  query: string,
  topK = 10,
  threshold = 0.3,
): Promise<KnowledgeBaseRetrievalResult> {
  const primaryChunks = await searchKnowledgeBase(agentId, query, topK, threshold);
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

  return chunks
    .map((chunk, index) => {
      const relevancePercent = Math.round(chunk.similarity * 100);
      return `${index + 1}. [Релевантность: ${relevancePercent}%]\n${chunk.content}`;
    })
    .join('\n\n');
}
