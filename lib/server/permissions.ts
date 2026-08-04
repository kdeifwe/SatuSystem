import type { SupabaseClient } from '@supabase/supabase-js';

export type OrgMembership = {
  org_id: string;
  role: 'owner' | 'admin' | 'member';
};

export function isOwnerOrAdminRole(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

export async function getOrgMembership(
  supabase: SupabaseClient,
  userId: string,
  orgId?: string,
): Promise<OrgMembership | null> {
  const baseQuery = supabase
    .from('org_members')
    .select('org_id, role')
    .eq('user_id', userId);

  const activeQuery = orgId ? baseQuery.eq('org_id', orgId) : baseQuery;
  const { data, error } = await activeQuery.maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as OrgMembership;
}

export async function requireOwnerOrAdmin(
  supabase: SupabaseClient,
  userId: string,
  orgId?: string,
): Promise<OrgMembership> {
  const membership = await getOrgMembership(supabase, userId, orgId);

  if (!membership) {
    throw new Error('Организация не найдена');
  }

  if (orgId && membership.org_id !== orgId) {
    throw new Error('Нет прав на изменение этой настройки');
  }

  if (!isOwnerOrAdminRole(membership.role)) {
    throw new Error('Нет прав на изменение этой настройки');
  }

  return membership;
}
