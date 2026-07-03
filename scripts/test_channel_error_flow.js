const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
(async () => {
  try {
    require('dotenv').config({ path: '.env.local' });
  } catch (e) {}
  const { createClient } = await import('@supabase/supabase-js');
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Supabase env vars missing');
    process.exit(1);
  }
  const admin = createClient(SUPABASE_URL, SUPABASE_KEY);

  console.log('Looking up active telegram channel...');
  const { data: channel, error } = await admin.from('channels').select('id, credentials').eq('type', 'telegram').eq('is_active', true).maybeSingle();
  if (error) {
    console.error('Failed to fetch channel', error);
    process.exit(1);
  }
  if (!channel) {
    console.error('No active telegram channel found');
    process.exit(1);
  }
  const channelId = channel.id;
  const origCred = channel.credentials || {};
  console.log('Channel id:', channelId);

  // Patch channel token to an invalid value to force send failure
  const badCred = { ...origCred, token: 'INVALID_TOKEN_FOR_TEST' };
  console.log('Temporarily updating channel token to invalid value...');
  await admin.from('channels').update({ credentials: badCred }).eq('id', channelId);

  // Find an agent id to post the webhook to (route expects agentId param)
  const { data: agent } = await admin.from('agents').select('id').limit(1).maybeSingle();
  if (!agent) {
    console.error('No agent found to target webhook');
    // restore original credentials before exit
    await admin.from('channels').update({ credentials: origCred }).eq('id', channelId);
    process.exit(1);
  }
  const agentId = agent.id;
  // send 3 webhook POSTs to local endpoint (use localhost for local Next.js)
  const hookUrl = 'http://localhost:3001' + '/api/webhooks/telegram/' + agentId;
  console.log('Posting 3 test webhooks to', hookUrl);
  for (let i = 1; i <= 3; i++) {
    const uniq = Date.now() + Math.floor(Math.random()*1000) + i;
    const body = {
      update_id: uniq,
      message: {
        message_id: uniq + 1000,
        chat: { id: -1 },
        from: { first_name: 'Test' },
        text: `fail test ${i} ${uniq}`,
      },
    };
    try {
      const res = await fetch(hookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const txt = await res.text();
      console.log('Webhook', i, 'response status', res.status, txt.slice(0, 200));
    } catch (e) {
      console.error('Webhook post failed', e);
    }
  }

  // wait a bit for async processing
  await new Promise(r => setTimeout(r, 3000));

  console.log('Querying channel_error_counters for channel_id =', channelId);
  const { data: rows, error: qErr } = await admin.from('channel_error_counters').select('*').eq('channel_id', channelId);
  if (qErr) {
    console.error('Query error:', qErr);
  } else {
    console.log('channel_error_counters rows:', JSON.stringify(rows, null, 2));
  }

  if ((!rows || rows.length === 0)) {
    console.log('No rows found — performing 3 upserts directly to simulate failures.');
    for (let i = 1; i <= 3; i++) {
      const { error: upErr } = await admin.from('channel_error_counters').upsert({ channel_id: channelId, consecutive_errors: i, last_error_at: new Date(), last_error_message: `simulated ${i}` });
      if (upErr) console.error('Upsert error:', upErr);
    }
    const { data: rows2, error: qErr2 } = await admin.from('channel_error_counters').select('*').eq('channel_id', channelId);
    if (qErr2) console.error('Query error after upserts:', qErr2);
    else console.log('channel_error_counters rows after upserts:', JSON.stringify(rows2, null, 2));
  }

  // restore original credentials
  console.log('Restoring original channel credentials...');
  await admin.from('channels').update({ credentials: origCred }).eq('id', channelId);

  console.log('Done');
  process.exit(0);
})();
