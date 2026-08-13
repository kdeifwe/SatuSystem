import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import { searchKnowledgeBaseWithLinks, getLinkedKBChunks } from '../lib/knowledge-base/search';
import { createClient } from '@supabase/supabase-js';

(async () => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
      process.exit(1);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: rows, error: selectError } = await supabase.from('kb_chunks').select('agent_id').limit(1);
    if (selectError) throw selectError;
    if (!rows || rows.length === 0) {
      console.error('No kb_chunks found in DB');
      process.exit(1);
    }

    const agentId = (rows[0] as any).agent_id;
    console.log('Using agentId:', agentId);

    const results = await searchKnowledgeBaseWithLinks(agentId, 'скидки', 5, 0.1);
    console.log('Search result (primaryChunks length):', results.primaryChunks.length);
    console.log(JSON.stringify(results.primaryChunks.slice(0, 5), null, 2));

    if (results.primaryChunks.length > 0) {
      const top = results.primaryChunks[0];
      const topId = top.chunk_id;
      const linked = await getLinkedKBChunks([topId]);
      console.log('Top chunk id:', topId);
      console.log('Linked chunks (first 3):', JSON.stringify(linked.slice(0, 3), null, 2));
    }
  } catch (err) {
    console.error('Error running canonical search:', err);
    process.exitCode = 2;
  }
})();
