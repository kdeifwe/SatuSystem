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

  const url = new URL(req.url);
  const scenarioId = url.searchParams.get('scenarioId');
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');
  const page = Number(url.searchParams.get('page') ?? '1');
  const pageSize = Number(url.searchParams.get('pageSize') ?? '20');

  const admin = getAdmin();
  let query = admin
    .from('scenario_runs')
    .select('id, scenario_id, lead_id, result, ran_at, scenario(name, org_id), lead(name, attributes)', { count: 'exact' })
    .order('ran_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1)
    .eq('scenario.org_id', orgId);

  if (scenarioId) query = query.eq('scenario_id', scenarioId);
  if (startDate) query = query.gte('ran_at', startDate);
  if (endDate) query = query.lte('ran_at', endDate);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    runs: data ?? [],
    page,
    pageSize,
    total: count ?? (data ? data.length : 0),
  });
}
