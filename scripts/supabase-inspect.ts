import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !KEY) {
  console.error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found in .env.local');
  process.exit(1);
}

const defaultTables = [
  'scheduled_messages',
  'scheduled_message',
  'scheduled_messages_v2',
  'notification_log',
  'notifications',
  'broadcasts',
  'messages',
];

function parseTablesArg(): string[] {
  const arg = process.argv.find((a) => a.startsWith('--tables='));
  if (arg) {
    const val = arg.split('=')[1] ?? '';
    return val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return defaultTables;
}

const candidateTables = parseTablesArg();

function apiUrl(path: string) {
  return `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`;
}

async function getCount(table: string) {
  try {
    const url = `${apiUrl(table)}?select=id&limit=0`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        Prefer: 'count=exact',
      },
    });

    const contentRange = res.headers.get('content-range') || res.headers.get('Content-Range');
    if (contentRange) {
      const parts = contentRange.split('/');
      return { count: Number(parts[1]) };
    }

    // fallback: try to parse JSON length
    const data = await res.json().catch(() => null);
    if (Array.isArray(data)) return { count: data.length };
    return { count: null };
  } catch (err) {
    return { error: String(err) };
  }
}

async function getMinMax(table: string) {
  try {
    const minUrl = `${apiUrl(table)}?select=created_at&order=created_at.asc&limit=1`;
    const maxUrl = `${apiUrl(table)}?select=created_at&order=created_at.desc&limit=1`;
    const [minRes, maxRes] = await Promise.all([
      fetch(minUrl, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }),
      fetch(maxUrl, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }),
    ]);
    if (!minRes.ok || !maxRes.ok) return { error: `Failed min/max request: ${minRes.status}/${maxRes.status}` };
    const minData = await minRes.json().catch(() => null);
    const maxData = await maxRes.json().catch(() => null);
    return { min: minData?.[0]?.created_at ?? null, max: maxData?.[0]?.created_at ?? null };
  } catch (err) {
    return { error: String(err) };
  }
}

async function getLastRows(table: string) {
  try {
    const url = `${apiUrl(table)}?select=*&order=created_at.desc&limit=5`;
    const res = await fetch(url, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!res.ok) return { error: `Request failed: ${res.status}` };
    const data = await res.json();
    return { rows: data };
  } catch (err) {
    return { error: String(err) };
  }
}

async function inspect() {
  for (const table of candidateTables) {
    console.log('---');
    console.log('Table:', table);

    const count = await getCount(table);
    console.log('Count:', JSON.stringify(count));

    const minmax = await getMinMax(table);
    console.log('Min/Max created_at:', JSON.stringify(minmax));

    const last = await getLastRows(table);
    console.log('Last rows (up to 5):', JSON.stringify(last, null, 2));
  }
}

inspect().catch((e) => {
  console.error('Inspect failed', e);
  process.exit(1);
});
