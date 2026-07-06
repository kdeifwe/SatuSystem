// lib/search.ts
// Compatibility wrapper for the knowledge-base retrieval flow.

import { createClient } from '@supabase/supabase-js';
import { generateQueryEmbedding } from './knowledge-base/embeddings';

const TOP_K = 5;
const MIN_SIMILARITY = 0.5;

export interface SearchResult {
  id: string;
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
  source_title?: string;
}

export async function searchKnowledgeBase(
  agentId: string,
  query: string,
  topK = TOP_K,
): Promise<SearchResult[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const queryEmbedding = await generateQueryEmbedding(query);
  const { data, error } = await supabase.rpc('search_knowledge_base', {
    p_agent_id: agentId,
    query_embedding: queryEmbedding,
    match_count: topK,
    similarity_threshold: MIN_SIMILARITY,
  });

  if (error) throw new Error(`KB search error: ${error.message}`);

  return (data ?? []).map((row: any) => ({
    id: row.chunk_id,
    content: row.content,
    similarity: row.similarity,
    metadata: row.metadata || {},
    source_title: row.metadata?.source_title as string | undefined,
  })) as SearchResult[];
}

export function formatChunksForPrompt(chunks: SearchResult[]): string {
  if (chunks.length === 0) return 'Информация в базе знаний не найдена.';

  return chunks
    .map((chunk, index) => `[${index + 1}] ${chunk.source_title ? `Источник: ${chunk.source_title}\n` : ''}${chunk.content}`)
    .join('\n\n---\n\n');
}