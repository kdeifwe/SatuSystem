import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

  // 1) count summary ai_call_logs
  const headRes = await supabase
    .from('ai_call_logs')
    .select('*', { count: 'exact', head: true })
    .filter("request->>type", 'eq', 'summary')
    .gte('created_at', since);

  const summaryCount = headRes.count ?? 0;
  console.log('summary ai_call_logs in last 48h:', summaryCount);

  // 2) fetch recent messages and group by conversation
  const { data: msgs, error } = await supabase
    .from('messages')
    .select('id,conversation_id,created_at')
    .gte('created_at', since)
    .limit(10000);

  if (error) {
    console.error('messages query error', error);
    process.exit(2);
  }

  const counts = new Map<string, number>();
  for (const m of msgs || []) {
    const conv = (m as any).conversation_id;
    if (!conv) continue;
    counts.set(conv, (counts.get(conv) || 0) + 1);
  }

  const many = Array.from(counts.entries()).filter(([_, c]) => c >= 20);
  console.log('conversations with >=20 messages in last 48h:', many.length);
  console.log('sample (up to 10):', many.slice(0, 10));
}

main().catch((e) => { console.error(e); process.exit(2); });
