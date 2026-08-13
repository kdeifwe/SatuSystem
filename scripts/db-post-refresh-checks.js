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

    // link type counts
    // aggregate link_type counts
    const { data: allLinks, error: allErr } = await supabase.from('kb_chunk_links').select('link_type').limit(200000);
    if (allErr) throw allErr;
    const agg = {};
    for (const r of (allLinks||[])) {
      agg[r.link_type] = (agg[r.link_type]||0) + 1;
    }
    console.log('link_type_counts', agg);

    // find agent Aigerim by name (guess: profile name?) — instead, search chunks containing 'скидк' text and pick top chunk
    const { data: found } = await supabase.from('kb_chunks').select('id,content,agent_id').ilike('content','%скидк%').limit(10);
    console.log('found скидки chunks count', (found||[]).length);
    if (found && found.length>0) {
      const chunk = found[0];
      console.log('sample chunk id', chunk.id);
      const { data: linked } = await supabase.rpc('get_linked_kb_chunks', { p_chunk_ids: [chunk.id] });
      console.log('linked for sample', linked && linked.slice(0,3));
    }

  } catch (e) {
    console.error('failed checks', e);
    process.exit(2);
  }
})();
