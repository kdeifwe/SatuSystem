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

function rerankWithKeywords(
  chunks: KBSearchResult[],
  query: string
): KBSearchResult[] {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  return chunks
    .map(chunk => {
      const content = chunk.content.toLowerCase();
      const keywordBonus = queryWords.filter(w => content.includes(w)).length * 0.05;
      return { ...chunk, similarity: Math.min(1, chunk.similarity + keywordBonus) };
    })
    .sort((a, b) => b.similarity - a.similarity);
}

export async function searchKnowledgeBase(
  agentId: string,
  query: string,
  topK = 10,
  threshold = 0.3
): Promise<KBSearchResult[]> {
  const supabase = getAdminClient();

  try {
    // Генерировать эмбеддинг запроса с taskType RETRIEVAL_QUERY
    const queryEmbedding = await generateQueryEmbedding(query);

    // Вызвать RPC функцию search_knowledge_base
    const { data, error } = await supabase.rpc('search_knowledge_base', {
      p_agent_id: agentId,
      query_embedding: queryEmbedding,
      match_count: topK,
      similarity_threshold: threshold,
    });

    if (error) throw error;

    // Преобразовать результаты в KBSearchResult[] и переранжировать
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
