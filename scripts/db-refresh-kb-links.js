const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function parseEnvFile(p) {
  const s = fs.readFileSync(p, 'utf8');
  const out = {};
  s.split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (m) {
      let val = m[2];
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1,-1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1,-1);
      out[m[1]] = val;
    }
  });
  return out;
}

(async function(){
  try {
    const envPath = path.resolve(__dirname, '..', '.env.local');
    const env = parseEnvFile(envPath);
    const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
    const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.error('Missing SUPABASE_URL or SERVICE_ROLE_KEY in .env.local');
      process.exit(2);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // fetch agents with chunks
    const { data: chunkRows } = await supabase.from('kb_chunks').select('agent_id').limit(100000);
    const agentSet = new Set(chunkRows.map(r=>r.agent_id).filter(x=>x));
    const agents = Array.from(agentSet);

    const results = [];

    // run sequentially
    for (const aid of agents) {
      console.log('Refreshing for', aid);
      const { error: rpcErr } = await supabase.rpc('refresh_kb_chunk_links', { p_agent_id: aid, p_top_k: 3, p_min_similarity: 0.75 });
      if (rpcErr) {
        console.error('RPC error for', aid, rpcErr);
        results.push({ agent: aid, status: 'error', error: rpcErr });
      } else {
        console.log('Refreshed', aid);
        results.push({ agent: aid, status: 'ok' });
      }
    }

    // post checks
    const { data: linkCounts } = await supabase.rpc('','');
    console.log('Done', JSON.stringify(results, null, 2));
  } catch (e) {
    console.error('failed', e);
    process.exit(2);
  }
})();
