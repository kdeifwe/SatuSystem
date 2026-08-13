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
    const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.error('Missing SUPABASE_URL or SERVICE_ROLE_KEY in .env.local');
      process.exit(2);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // fetch chunks
    const { data: chunks, error: chunksErr } = await supabase.from('kb_chunks').select('id,agent_id').limit(100000);
    if (chunksErr) { console.error('kb_chunks error', chunksErr); process.exit(2); }

    // distinct agent ids
    const agentSet = new Set();
    const chunksByAgent = {};
    for (const r of chunks) {
      const aid = r.agent_id;
      agentSet.add(aid);
      chunksByAgent[aid] = (chunksByAgent[aid] || 0) + 1;
    }
    const agents = Array.from(agentSet).filter(x=>x!=null);

    // fetch semantic links
    const { data: links, error: linksErr } = await supabase.from('kb_chunk_links').select('agent_id,link_type').in('link_type',['semantic']).limit(100000);
    if (linksErr) { console.error('kb_chunk_links error', linksErr); process.exit(2); }
    const semanticByAgent = {};
    for (const l of links) {
      const aid = l.agent_id;
      semanticByAgent[aid] = (semanticByAgent[aid] || 0) + 1;
    }

    const perAgent = agents.map(aid => ({ agent_id: aid, chunks: chunksByAgent[aid]||0, semantic_links: semanticByAgent[aid]||0 }));

    const totalSemantic = links.length;

    console.log(JSON.stringify({ agents: perAgent, totalSemantic }, null, 2));
  } catch (e) {
    console.error('script-failed', e);
    process.exit(2);
  }
})();
