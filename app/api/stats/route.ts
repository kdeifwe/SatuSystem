import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

function resolvePeriodBounds(period: string, fromParam: string | null, toParam: string | null) {
  const now = new Date();
  const end = toParam ? new Date(toParam) : now;

  if (period === 'custom' && fromParam && toParam) {
    return {
      from: new Date(fromParam),
      to: end,
    };
  }

  const start = fromParam ? new Date(fromParam) : new Date(end);

  if (period === 'day') {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { from: start, to: end };
  }

  if (period === 'week') {
    const day = start.getDay();
    const diff = (day + 6) % 7;
    start.setDate(start.getDate() - diff);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { from: start, to: end };
  }

  if (period === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { from: start, to: end };
  }

  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { from: start, to: end };
}

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') ?? 'month';
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const channel = searchParams.get('channel') ?? null;
  const campaign = searchParams.get('campaign') ?? null;
  const outcome = searchParams.get('outcome') ?? null;
  const agentId = searchParams.get('agent_id') ?? null;

  const { from, to } = resolvePeriodBounds(period, fromParam, toParam);

  const { data: membership, error: membershipError } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership?.org_id) {
    return NextResponse.json({ error: 'Нет доступа к организации' }, { status: 403 });
  }

  const { data, error } = await supabase.rpc('fn_get_stats', {
    p_org_id: membership.org_id,
    p_agent_id: agentId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_channel: channel,
    p_campaign: campaign,
    p_outcome: outcome,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? {});
}
