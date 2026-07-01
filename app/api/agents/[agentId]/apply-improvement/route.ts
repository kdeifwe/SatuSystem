import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

export async function POST(
  req: NextRequest,
  { params }: { params: { agentId: string } }
) {
  const userSupabase = createUserClient();
  const {
    data: { user },
  } = await userSupabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
  }

  const { improved_prompt, change_note } = await req.json();
  if (!improved_prompt) {
    return NextResponse.json({ error: 'improved_prompt обязателен' }, { status: 400 });
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: agent, error: agentError } = await admin
    .from('agents')
    .select('*')
    .eq('id', params.agentId)
    .single();

  if (agentError || !agent) {
    return NextResponse.json({ error: 'Агент не найден' }, { status: 404 });
  }

  const { error: versionError } = await admin.from('agent_versions').insert({
    agent_id: params.agentId,
    snapshot: agent,
    change_note: change_note ?? 'Улучшение через чат',
    created_by: user.id,
  });

  if (versionError) {
    return NextResponse.json({ error: versionError.message }, { status: 500 });
  }

  const { error: updateError } = await admin
    .from('agents')
    .update({ system_prompt_compiled: improved_prompt })
    .eq('id', params.agentId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
