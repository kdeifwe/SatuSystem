import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import 'dotenv/config';
import { POST as acceptInvite } from '../app/api/invites/accept/route.ts';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !serviceRoleKey || !anonKey) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_ANON_KEY before running this script.');
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const uniqueSuffix = randomUUID().slice(0, 8);
const ownerEmail = `invite-flow-owner-${uniqueSuffix}@example.com`;
const joinEmail = `invite-flow-join-${uniqueSuffix}@example.com`;
const outsiderEmail = `invite-flow-outsider-${uniqueSuffix}@example.com`;
const password = 'Password123!';

async function cleanupTestUsers() {
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) throw error;

  const matchingUsers = (data?.users ?? []).filter((user) => user.email?.startsWith('invite-flow-') && user.email.endsWith('@example.com'));
  for (const user of matchingUsers) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
        if (!deleteError) {
          break;
        }
        if (deleteError.message?.includes('not found') || deleteError.message?.includes('already')) {
          break;
        }
        if (attempt === 3) {
          console.warn(`Cleanup warning for ${user.email}: ${deleteError.name ?? 'AuthError'} ${deleteError.message ?? JSON.stringify(deleteError)}`);
        } else {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      } catch (cleanupError) {
        if (attempt === 3) {
          console.warn(`Cleanup warning for ${user.email}: ${cleanupError?.name ?? 'Error'} ${cleanupError?.message ?? JSON.stringify(cleanupError)}`);
        } else {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    }
  }
}

async function ensureUser(email) {
  const existingUsers = await admin.auth.admin.listUsers();
  const existing = existingUsers.data?.users?.find((user) => user.email === email);
  if (existing?.id) {
    return existing.id;
  }

  const response = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (response.error) {
    if (response.error.message?.includes('already') || response.error.message?.includes('registered')) {
      const retryUsers = await admin.auth.admin.listUsers();
      const retry = retryUsers.data?.users?.find((user) => user.email === email);
      if (retry?.id) {
        return retry.id;
      }
    }
    throw response.error;
  }

  return response.data?.user?.id ?? null;
}

async function main() {
  await cleanupTestUsers();

  const ownerId = await ensureUser(ownerEmail);
  const outsiderId = await ensureUser(outsiderEmail);

  const orgInsert = await admin
    .from('organizations')
    .insert({ name: 'Invite Flow Verification Org', timezone: 'UTC', currency: 'USD' })
    .select('id')
    .single();

  if (orgInsert.error) throw orgInsert.error;
  const orgId = orgInsert.data.id;

  await admin.from('profiles').upsert({ id: ownerId, email: ownerEmail, full_name: 'Owner' });
  await admin.from('profiles').upsert({ id: outsiderId, email: outsiderEmail, full_name: 'Outsider' });
  await admin.from('org_members').upsert({ org_id: orgId, user_id: ownerId, role: 'owner' });

  const token = randomUUID();
  const inviteInsert = await admin
    .from('invites')
    .insert({
      org_id: orgId,
      email: joinEmail,
      role: 'member',
      token,
      status: 'pending',
      created_by: ownerId,
      sent_at: new Date().toISOString(),
    })
    .select('id, token')
    .single();

  if (inviteInsert.error) throw inviteInsert.error;

  const acceptResponse = await acceptInvite(
    new Request('http://localhost/api/invites/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, password }),
    })
  );

  const acceptBody = await acceptResponse.json();
  console.log('1) invite accepted:', acceptResponse.status, acceptBody);

  const { data: joinProfile, error: joinProfileError } = await admin
    .from('profiles')
    .select('id')
    .eq('email', joinEmail)
    .single();

  if (joinProfileError) throw joinProfileError;

  const { data: memberRows, error: memberError } = await admin
    .from('org_members')
    .select('org_id, user_id, role')
    .eq('user_id', joinProfile.id);

  if (memberError) throw memberError;
  console.log('2) org_members rows for invitee:', memberRows);

  const joinClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const joinSignIn = await joinClient.auth.signInWithPassword({ email: joinEmail, password });
  if (joinSignIn.error) throw joinSignIn.error;

  const { data: joinOrgs, error: joinOrgsError } = await joinClient.from('organizations').select('id,name');
  if (joinOrgsError) throw joinOrgsError;
  console.log('3) invitee sees organizations:', joinOrgs);

  const outsiderClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const outsiderSignIn = await outsiderClient.auth.signInWithPassword({ email: outsiderEmail, password });
  if (outsiderSignIn.error) throw outsiderSignIn.error;

  const { data: outsiderOrgs, error: outsiderOrgsError } = await outsiderClient.from('organizations').select('id,name');
  if (outsiderOrgsError) throw outsiderOrgsError;
  console.log('4) outsider sees organizations:', outsiderOrgs);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
