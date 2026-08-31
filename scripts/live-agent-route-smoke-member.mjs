import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error('Missing Supabase env');
}

const email = `agent-member-smoke-${Date.now()}@mailinator.com`;
const password = 'Password123!';
const orgId = crypto.randomUUID();
const admin = createSupabaseClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createSupabaseClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function cleanup() {
  await admin.from('agents').delete().eq('org_id', orgId);
  await admin.from('org_members').delete().eq('org_id', orgId);
  await admin.from('organizations').delete().eq('id', orgId);
  await admin.auth.admin.deleteUser(createdUserId);
}

let createdUserId = null;

try {
  const createdUser = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: 'Smoke Member' },
  });
  if (createdUser.error) throw createdUser.error;
  createdUserId = createdUser.data.user.id;

  const { error: orgError } = await admin.from('organizations').insert({ id: orgId, name: `Member Smoke Org ${Date.now()}` });
  if (orgError) throw orgError;

  const { error: profileError } = await admin.from('profiles').insert({ id: createdUser.data.user.id });
  if (profileError) throw profileError;

  const { error: memberError } = await admin.from('org_members').insert({
    org_id: orgId,
    user_id: createdUser.data.user.id,
    role: 'member',
  });
  if (memberError) throw memberError;

  const { data: signInData, error: signInError } = await anon.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const accessToken = signInData.session?.access_token;
  if (!accessToken) throw new Error('No access token');

  const baseUrl = 'http://127.0.0.1:3000';

  async function request(path, init = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        authorization: `Bearer ${accessToken}`,
      },
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status, body };
  }

  const createResult = await request('/api/agents/create', { method: 'POST' });
  console.log('create', JSON.stringify(createResult));
  const agentId = createResult.body?.agentId ?? createResult.body?.id;
  if (!agentId) throw new Error('No agent id returned');

  const getResult = await request(`/api/agents/${agentId}`);
  console.log('get', JSON.stringify(getResult));

  const patchResult = await request(`/api/agents/${agentId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goal: 'patched-via-member-http' }),
  });
  console.log('patch', JSON.stringify(patchResult));

  const deleteResult = await request(`/api/agents/${agentId}`, { method: 'DELETE' });
  console.log('delete', JSON.stringify(deleteResult));
} finally {
  if (createdUserId) {
    try {
      await admin.from('agents').delete().eq('org_id', orgId);
      await admin.from('org_members').delete().eq('org_id', orgId);
      await admin.from('organizations').delete().eq('id', orgId);
      await admin.auth.admin.deleteUser(createdUserId);
    } catch (cleanupErr) {
      console.error('cleanup failed', cleanupErr);
    }
  }
}
