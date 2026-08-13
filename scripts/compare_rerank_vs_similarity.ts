import { createClient } from '@supabase/supabase-js';
require('dotenv').config({ path: '.env.local' });
import { generateQueryEmbedding } from '../lib/knowledge-base/embeddings';

(async () => {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const agentId = '1469465d-418d-44ac-9751-a304666e6dc4';
  const queries = ['скидки', 'ABSOLUTE 8.5'];

  for (const query of queries) {
    console.log('\n==== QUERY:', query, '====');
    const emb = await generateQueryEmbedding(query);
    const { data } = await supabase.rpc('search_knowledge_base', { p_agent_id: agentId, query_embedding: emb, match_count: 300, similarity_threshold: 0.0 });
  const rows = (data || []).map((r: any) => ({ chunk_id: r.chunk_id as string, content: r.content as string, similarity: Number(r.similarity), priority: r.priority, metadata: r.metadata || {} }));

  function merge(primary: any[], secondary: any[]) {
    const m = new Map<string, any>();
    for (const c of [...primary, ...secondary]) {
      const e = m.get(c.chunk_id);
      if (!e || c.similarity > e.similarity) m.set(c.chunk_id, c);
    }
    return Array.from(m.values()).sort((a, b) => b.similarity - a.similarity);
  }

  function rerank(chunks: any[], q: string) {
    const queryWords = new Set(q.toLowerCase().replace(/[^\w\sа-яәіңғүұқөһ]/gi, '').split(/\s+/).filter((w) => w.length > 3));
    return chunks
      .map((chunk) => {
        const contentWords = new Set(chunk.content.toLowerCase().replace(/[^\w\sа-яәіңғүұқөһ]/gi, '').split(/\s+/));
        const intersection = [...queryWords].filter((w) => contentWords.has(w)).length;
        const coverage = queryWords.size > 0 ? intersection / queryWords.size : 0;
        const rerankedScore = chunk.similarity + coverage * 0.25;
        return { ...chunk, similarity: Math.min(rerankedScore, 1.0) };
      })
      .sort((a, b) => b.similarity - a.similarity);
  }

  function getChunkPriorityBoost(chunk: any) {
    const metadata = chunk.metadata ?? {};
    const priority = typeof chunk.priority === 'string' && chunk.priority.trim() ? chunk.priority.trim().toLowerCase() : null;
    const type = (metadata['type'] && String(metadata['type']).toLowerCase()) || (metadata['category'] && String(metadata['category']).toLowerCase()) || null;
    const sourceType = (metadata['source_type'] && String(metadata['source_type']).toLowerCase()) || null;
    let boost = 0;
    if (priority === 'structured' || priority === 'qa') boost += 0.18;
    if (type === 'product' || type === 'faq') boost += 0.14;
    else if (type === 'procedure' || type === 'contact') boost += 0.08;
    if (sourceType === 'instagram') boost -= 0.16;
    if (!type || type === 'other') boost -= 0.06;
    return boost;
  }

  function rankKnowledgeBaseChunks(chunks: any[], q = '') {
    const queryWords = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    return [...chunks]
      .map((chunk) => {
        const content = chunk.content.toLowerCase();
        const keywordBonus = queryWords.filter((word) => content.includes(word)).length * 0.05;
        const rankingScore = chunk.similarity + keywordBonus + getChunkPriorityBoost(chunk);
        return { chunk, rankingScore };
      })
      .sort((a, b) => {
        if (b.rankingScore !== a.rankingScore) return b.rankingScore - a.rankingScore;
        return b.chunk.similarity - a.chunk.similarity;
      })
      .map((x) => x.chunk);
  }

    const merged = merge(rows, rows);
    const reranked = rerank(merged, query);
    const ranked = rankKnowledgeBaseChunks(reranked, query);

    const targetIds = ['ec7401ae-9eeb-4c50-acb3-08c063145ac5', '0c76c57a-31a0-496f-ab35-bc827a9fd5ef'];
  function pos(list: any[], id: string) {
    const idx = list.findIndex((c) => c.chunk_id === id);
    return idx === -1 ? null : idx + 1;
  }

    console.log('positions (ranked):', targetIds.map((id) => ({ id, pos: pos(ranked, id), sim: ranked.find((c) => c.chunk_id === id)?.similarity })));

    console.log('\nTOP10 (final ranked order):');
    ranked.slice(0, 10).forEach((c: any, i: number) => console.log(i + 1, c.chunk_id, c.similarity));

    // show components for top few
    console.log('\nTOP 15 COMPONENTS (rankingScore components):');
    const topComponents = ranked.slice(0, 15).map((chunk: any) => {
      const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const keywordBonus = queryWords.filter((word) => chunk.content.toLowerCase().includes(word)).length * 0.05;
      const priorityBoost = getChunkPriorityBoost(chunk);
      const rankingScore = chunk.similarity + keywordBonus + priorityBoost;
      return { id: chunk.chunk_id, sim: chunk.similarity, keywordBonus, priorityBoost, rankingScore };
    });
    topComponents.forEach((c: any, i: number) => console.log(i + 1, c));
  }

})();
