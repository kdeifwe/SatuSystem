import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import 'dotenv/config';

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
const ownerEmail = `invite-rls-owner-${uniqueSuffix}@example.com`;
const adminEmail = `invite-rls-admin-${uniqueSuffix}@example.com`;
const memberEmail = `invite-rls-member-${uniqueSuffix}@example.com`;
const password = 'Password123!';

async function cleanupAuthUsers() {
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) throw error;

  for (const user of (data?.users ?? []).filter((candidate) => candidate.email?.startsWith('invite-rls-') && candidate.email.endsWith('@example.com'))) {
    try {
      await admin.auth.admin.deleteUser(user.id);
    } catch (cleanupError) {
      console.warn(`Cleanup warning for ${user.email}:`, cleanupError?.message ?? cleanupError);
    }
  }
}

async function cleanupTestRows(orgId, userIds) {
  if (orgId) {
    await admin.from('invites').delete().eq('org_id', orgId);
    await admin.from('org_members').delete().eq('org_id', orgId);
    await admin.from('organizations').delete().eq('id', orgId);
  }

  if (userIds.length) {
    await admin.from('profiles').delete().in('id', userIds);
  }
}

async function ensureUser(email) {
  const { data: existingUsers, error: listError } = await admin.auth.admin.listUsers();
  if (listError) throw listError;
  const existing = existingUsers?.users?.find((user) => user.email === email);
  if (existing?.id) return existing.id;

  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  return data.user?.id;
}

async function main() {
  await cleanupAuthUsers();

  const ownerId = await ensureUser(ownerEmail);
  const adminId = await ensureUser(adminEmail);
  const memberId = await ensureUser(memberEmail);
  const userIds = [ownerId, adminId, memberId];
  let orgId = null;

  try {
    const { data: orgData, error: orgError } = await admin
      .from('organizations')
      .insert({ name: `Invite RLS Test Org ${uniqueSuffix}`, timezone: 'UTC', currency: 'USD' })
      .select('id')
      .single();

    if (orgError) throw orgError;
    orgId = orgData.id;

    await admin.from('profiles').upsert({ id: ownerId, email: ownerEmail, full_name: 'Owner' });
    await admin.from('profiles').upsert({ id: adminId, email: adminEmail, full_name: 'Admin' });
    await admin.from('profiles').upsert({ id: memberId, email: memberEmail, full_name: 'Member' });
    await admin.from('org_members').upsert({ org_id: orgId, user_id: ownerId, role: 'owner' });
    await admin.from('org_members').upsert({ org_id: orgId, user_id: adminId, role: 'admin' });
    await admin.from('org_members').upsert({ org_id: orgId, user_id: memberId, role: 'member' });

    const memberClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: memberSignInError } = await memberClient.auth.signInWithPassword({ email: memberEmail, password });
    if (memberSignInError) throw memberSignInError;

    const { data: memberInsertData, error: memberInsertError } = await memberClient
      .from('invites')
      .insert({
        org_id: orgId,
        email: `invite-target-${uniqueSuffix}@example.com`,
        role: 'owner',
        token: randomUUID(),
        status: 'pending',
        created_by: memberId,
        sent_at: new Date().toISOString(),
      })
      .select('id');

    if (memberInsertError) {
      console.log('member RLS_denied', memberInsertError.message);
    } else {
      console.log('member RLS_allowed', memberInsertData);
    }

    const adminClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: adminSignInError } = await adminClient.auth.signInWithPassword({ email: adminEmail, password });
    if (adminSignInError) throw adminSignInError;

    for (const targetRole of ['member', 'admin', 'owner']) {
      const { data: adminInsertData, error: adminInsertError } = await adminClient
        .from('invites')
        .insert({
          org_id: orgId,
          email: `invite-target-${targetRole}-${uniqueSuffix}@example.com`,
          role: targetRole,
          token: randomUUID(),
          status: 'pending',
          created_by: adminId,
          sent_at: new Date().toISOString(),
        })
        .select('id');

      if (adminInsertError) {
        console.log(`admin ${targetRole} RLS_denied`, adminInsertError.message);
      } else {
        console.log(`admin ${targetRole} RLS_allowed`, adminInsertData);
      }
    }
  } finally {
    await cleanupTestRows(orgId, userIds);
    await cleanupAuthUsers();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
