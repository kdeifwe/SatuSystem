import { NextResponse } from 'next/server';
import { createClient as createSupabaseServer } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { requireOwnerOrAdmin } from '@/lib/server/permissions';
import { applyAgentVisibilityFilter } from '@/lib/agents/visibility';
import type { SupabaseClient } from '@supabase/supabase-js';

export type AuthResult =
  | { ok: true; userId: string; admin: SupabaseClient; orgId?: string }
  | { ok: false; response: NextResponse };

// Базовая проверка: пользователь авторизован и является owner/admin организации
export async function requireOwnerOrAdminApi(orgId?: string): Promise<AuthResult> {
  const supabase = createSupabaseServer();
  const { data: { user } = {} as any, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { ok: false, response: NextResponse.json({ error: 'Не авторизован' }, { status: 401 }) };
  }

  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    const membership = await requireOwnerOrAdmin(admin, user.id, orgId);
    return { ok: true, userId: user.id, admin, orgId: membership.org_id };
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Нет прав' }, { status: 403 }) };
  }
}

// Проверка доступа к конкретному агенту (паттерн как в app/api/agents/[agentId]/route.ts)
export async function requireAgentAccess(agentId: string): Promise<AuthResult> {
  const base = await requireOwnerOrAdminApi();
  if (!base.ok) return base;

  const { data: agent, error } = await applyAgentVisibilityFilter(
    base.admin.from('agents').select('id, org_id')
  ).eq('id', agentId).maybeSingle();

  if (error || !agent) {
    return { ok: false, response: NextResponse.json({ error: 'Агент не найден' }, { status: 404 }) };
  }

  // Перепроверяем членство именно в org агента
  const scoped = await requireOwnerOrAdminApi(agent.org_id);
  if (!scoped.ok) return scoped;
  return { ...scoped, orgId: agent.org_id };
}
