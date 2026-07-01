import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

function getAdmin() {
  return createAdminClient();
}

async function getOrgId(agentId: string) {
  const admin = getAdmin();
  const { data, error } = await admin
    .from('agents')
    .select('org_id')
    .eq('id', agentId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data?.org_id;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { agentId: string; scenarioId: string } }
) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const orgId = await getOrgId(params.agentId);
  if (!orgId) return NextResponse.json({ error: 'Агент не найден' }, { status: 404 });

  const admin = getAdmin();
  const { data, error } = await admin
    .from('scenarios')
    .select('id, name, trigger, actions, is_active, created_at')
    .eq('org_id', orgId)
    .eq('id', params.scenarioId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? {});
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { agentId: string; scenarioId: string } }
) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const orgId = await getOrgId(params.agentId);
  if (!orgId) return NextResponse.json({ error: 'Агент не найден' }, { status: 404 });

  const body = await req.json();
  const updates: Record<string, unknown> = {};
  if ('name' in body) updates.name = body.name;
  if ('trigger' in body) updates.trigger = body.trigger;
  if ('actions' in body) updates.actions = body.actions;
  if ('is_active' in body) updates.is_active = body.is_active;

  const admin = getAdmin();
  const { data, error } = await admin
    .from('scenarios')
    .update(updates)
    .eq('org_id', orgId)
    .eq('id', params.scenarioId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { agentId: string; scenarioId: string } }
) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const orgId = await getOrgId(params.agentId);
  if (!orgId) return NextResponse.json({ error: 'Агент не найден' }, { status: 404 });

  const admin = getAdmin();
  const { error } = await admin
    .from('scenarios')
    .delete()
    .eq('org_id', orgId)
    .eq('id', params.scenarioId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
