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
  { params }: { params: { agentId: string } }
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
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { agentId: string } }
) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const body = await req.json();
  const orgId = await getOrgId(params.agentId);
  if (!orgId) return NextResponse.json({ error: 'Агент не найден' }, { status: 404 });

  const { name, trigger, actions, is_active } = body;
  if (!name || !trigger || !actions) {
    return NextResponse.json({ error: 'name, trigger и actions обязательны' }, { status: 400 });
  }

  const admin = getAdmin();
  const { data, error } = await admin
    .from('scenarios')
    .insert([{ org_id: orgId, name, trigger, actions, is_active: Boolean(is_active ?? true) }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
