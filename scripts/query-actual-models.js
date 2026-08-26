const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.argv[2] || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.argv[3] || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

async function main() {
  try {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('ai_call_logs')
      .select('id, created_at, request, response')
      .gte('created_at', twoDaysAgo)
      .filter("request->>actual_provider", 'eq', 'openai')
      .order('created_at', { ascending: false })
      .limit(10000);

    if (error) throw error;

    const counts = {};
    for (const row of data) {
      const model = (row.request && (row.request.actual_model || row.request.model || (row.request.request && row.request.request.actual_model))) || 'UNKNOWN';
      counts[model] = (counts[model] || 0) + 1;
    }

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    console.log('Distinct actual_model counts for requests with actual_provider=openai (last 2 days):');
    for (const [model, cnt] of sorted) {
      console.log(`${model}: ${cnt}`);
    }

    // Also show distinct models from response payloads if present
    const respCounts = {};
    for (const row of data) {
      const respModel = (row.response && (row.response.actual_model || row.response.model || row.response.provider)) || 'UNKNOWN';
      respCounts[respModel] = (respCounts[respModel] || 0) + 1;
    }
    console.log('\nDistinct models found in response payloads:');
    for (const [m, c] of Object.entries(respCounts)) console.log(`${m}: ${c}`);

    // Now check records where response->>provider = 'openai' explicitly
    const { data: respData, error: respError } = await supabase
      .from('ai_call_logs')
      .select('id, created_at, request, response')
      .gte('created_at', twoDaysAgo)
      .filter("response->>provider", 'eq', 'openai')
      .order('created_at', { ascending: false })
      .limit(10000);

    if (respError) throw respError;

    console.log('\nRecent ai_call_logs with response.provider = openai:');
    for (const row of respData.slice(0, 20)) {
      console.log('---');
      console.log(row.created_at, row.id);
      console.log('request.model:', row.request && (row.request.model || row.request.actual_model));
      console.log('request.actual_provider:', row.request && row.request.actual_provider);
      console.log('response.provider:', row.response && row.response.provider);
      console.log('response.model:', row.response && (row.response.model || row.response.actual_model || JSON.stringify(row.response.provider)));
    }

    if (respData.length > 0) {
      const exampleId = respData[0].id;
      const { data: fullRow } = await supabase.from('ai_call_logs').select('*').eq('id', exampleId).single();
      console.log('\nFull ai_call_logs row JSON for inspection:');
      console.log(JSON.stringify(fullRow, null, 2));
    }
  } catch (err) {
    console.error('Error querying ai_call_logs:', err.message || err);
    process.exit(1);
  }
}

main();
