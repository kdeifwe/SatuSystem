import { createClient } from '@supabase/supabase-js';
import { generateQueryEmbedding } from '../lib/knowledge-base/embeddings';

async function main() {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  // Find agent Айгерим
  const { data: agents, error: agentErr } = await supabase.from('agents').select('id,name').ilike('name', '%Айгерим%').limit(1);
  if (agentErr) throw agentErr;
  if (!agents || agents.length === 0) {
    console.error('Agent "Айгерим" not found');
    process.exit(2);
  }
  const agentId = agents[0].id as string;

  const query = process.argv[2] || 'примерное ключевое слово';
  console.log('Agent:', agents[0].name, agentId);
  console.log('Query:', query);

  let queryEmbedding: any = null;
  const seedChunkId = process.argv[3] || null;
  if (seedChunkId) {
    const { data: seedRow, error: seedErr } = await supabase.from('kb_chunks').select('embedding').eq('id', seedChunkId).single();
    if (seedErr) throw seedErr;
    queryEmbedding = seedRow.embedding;
  } else {
    queryEmbedding = await generateQueryEmbedding(query);
  }

  // Run vector-only (legacy) by not passing p_query_text
  console.log('\nRunning vector-only search (no p_query_text)...');
  const { data: vecData, error: vecErr } = await supabase.rpc('search_knowledge_base', {
    p_agent_id: agentId,
    query_embedding: queryEmbedding,
    match_count: 10,
    similarity_threshold: 0.0,
  });
  if (vecErr) throw vecErr;

  // Run hybrid search (with p_query_text)
  console.log('\nRunning hybrid search (with p_query_text) using test RPC...');
  const { data: hybData, error: hybErr } = await supabase.rpc('search_knowledge_base_hybrid_test', {
    p_agent_id: agentId,
    query_embedding: queryEmbedding,
    p_query_text: query,
    match_count: 10,
    similarity_threshold: 0.0,
  });
  if (hybErr) throw hybErr;

  function printResults(label: string, rows: any[]) {
    console.log('\n' + label + ':');
    if (!rows || rows.length === 0) {
      console.log('  (no results)');
      return;
    }
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const vectorVal = (r.vector_similarity !== undefined && r.vector_similarity !== null) ? r.vector_similarity : (r.similarity !== undefined ? r.similarity : NaN);
      const textVal = (r.text_rank !== undefined && r.text_rank !== null) ? r.text_rank : 0;
      const hybridVal = (r.hybrid_score !== undefined && r.hybrid_score !== null) ? r.hybrid_score : vectorVal;
      const fmt = (v: any) => (Number.isFinite(v) ? Number(v).toFixed(6) : 'NaN');
      console.log(`${i + 1}. id=${r.chunk_id} vector_similarity=${fmt(vectorVal)} text_rank=${fmt(textVal)} hybrid_score=${fmt(hybridVal)} source=${r.source_id} priority=${r.priority}`);
      if (r.content) console.log('   content excerpt:', (r.content as string).slice(0, 200).replace(/\n/g, ' '));
    }
  }

  printResults('Vector-only top', vecData as any[]);
  printResults('Hybrid top', hybData as any[]);

  // Show which chunk ids moved up
  const vecIds = (vecData || []).map((r: any) => r.chunk_id);
  const hybIds = (hybData || []).map((r: any) => r.chunk_id);
  console.log('\nMoved up in hybrid (first 10):');
  for (const id of hybIds.slice(0, 10)) {
    const vecPos = vecIds.indexOf(id);
    const hybPos = hybIds.indexOf(id);
    if (vecPos === -1 || hybPos < vecPos) {
      console.log(` - ${id} moved from ${vecPos === -1 ? 'not found' : vecPos + 1} -> ${hybPos + 1}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
