import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !anonKey) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY before running this script.');
}

const password = 'Password123!';
const email = 'agent-rls-owner-2e97d13c@mailinator.com';
const orgAId = '68b86536-1e62-49ec-bead-ffe6a6f987c5';
const orgBId = '7b1057f0-5882-4261-9461-d0c56f5324f9';
const agentAId = '75e2c30d-abc0-4df6-8613-405551654117';
const agentBId = 'e0fc6275-f02d-4986-bf90-62adeb7d7bca';

function createClientWithAnon() {
  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function ensureUser(client) {
  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const resolvedUserId = signInData.user?.id;
  if (!resolvedUserId) throw new Error(`No user id for ${email}`);
  return { id: resolvedUserId, client, accessToken: signInData.session?.access_token ?? null };
}

async function getAgent(accessToken, agentId) {
  const response = await fetch(`${supabaseUrl}/rest/v1/agents?id=eq.${agentId}&select=id,name,goal,org_id`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const body = await response.text();
  return { status: response.status, body };
}

async function patchAgent(accessToken, agentId, payload) {
  const response = await fetch(`${supabaseUrl}/rest/v1/agents?id=eq.${agentId}`, {
    method: 'PATCH',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  return { status: response.status, body };
}

async function deleteAgent(accessToken, agentId) {
  const response = await fetch(`${supabaseUrl}/rest/v1/agents?id=eq.${agentId}`, {
    method: 'DELETE',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const body = await response.text();
  return { status: response.status, body };
}

async function main() {
  const user = await ensureUser(createClientWithAnon());
  const client = user.client;
  const accessToken = user.accessToken;

  const memberPatchBefore = await getAgent(accessToken, agentBId);
  const memberPatchResponse = await patchAgent(accessToken, agentBId, { name: 'member patched' });
  const memberPatchAfter = await getAgent(accessToken, agentBId);
  const memberPatchDenied = memberPatchBefore.body === memberPatchAfter.body && memberPatchResponse.body === '[]';
  console.log('member patch', memberPatchDenied ? `RLS_denied ${memberPatchResponse.status} ${memberPatchResponse.body}` : `RLS_allowed ${memberPatchResponse.status} ${memberPatchResponse.body}`);

  const memberDeleteBefore = await getAgent(accessToken, agentBId);
  const memberDeleteResponse = await deleteAgent(accessToken, agentBId);
  const memberDeleteAfter = await getAgent(accessToken, agentBId);
  const memberDeleteDenied = memberDeleteBefore.body === memberDeleteAfter.body && memberDeleteResponse.status === 204;
  console.log('member delete', memberDeleteDenied ? `RLS_denied ${memberDeleteResponse.status} ${memberDeleteResponse.body}` : `RLS_allowed ${memberDeleteResponse.status} ${memberDeleteResponse.body}`);

  const ownerPatchResponse = await patchAgent(accessToken, agentAId, { goal: 'owner patched' });
  const ownerPatchAfter = await getAgent(accessToken, agentAId);
  const ownerPatchAllowed = ownerPatchAfter.body.includes('owner patched');
  console.log('owner patch', ownerPatchAllowed ? `RLS_allowed ${ownerPatchResponse.status} ${ownerPatchResponse.body}` : `RLS_denied ${ownerPatchResponse.status} ${ownerPatchResponse.body}`);

  const { error: adminRoleError } = await client.from('org_members').update({ role: 'admin' }).eq('org_id', orgAId).eq('user_id', user.id);
  if (adminRoleError) throw adminRoleError;

  const adminPatchResponse = await patchAgent(accessToken, agentAId, { name: 'admin patched' });
  const adminPatchAfter = await getAgent(accessToken, agentAId);
  const adminPatchAllowed = adminPatchAfter.body.includes('admin patched');
  console.log('admin patch', adminPatchAllowed ? `RLS_allowed ${adminPatchResponse.status} ${adminPatchResponse.body}` : `RLS_denied ${adminPatchResponse.status} ${adminPatchResponse.body}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
