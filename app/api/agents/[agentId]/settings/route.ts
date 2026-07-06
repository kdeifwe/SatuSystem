import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { compileAndSaveSystemPrompt } from '@/lib/ai/compile-system-prompt';

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function GET(req: NextRequest, { params }: { params: { agentId: string } }) {
  const supabase = createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const { data } = await getAdmin()
    .from('agents')
    .select('id, name, role, goal, goal_status, undefined_close_statuses, response_wait_hours, tone_of_voice, temperature, model, communication_rules, human_communication_style, knowledge_base_principles, system_prompt_compiled, general_capabilities')
    .eq('id', params.agentId)
    .single();

  return NextResponse.json(data ?? {});
}

export async function PATCH(req: NextRequest, { params }: { params: { agentId: string } }) {
  const supabase = createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const body = await req.json();

  const existing = await getAdmin()
    .from('agents')
    .select('system_prompt_compiled, general_capabilities')
    .eq('id', params.agentId)
    .single();

  const allowed = [
    'name',
    'role',
    'goal',
    'goal_status',
    'undefined_close_statuses',
    'response_wait_hours',
    'tone_of_voice',
    'temperature',
    'model',
    'communication_rules',
    'human_communication_style',
    'knowledge_base_principles',
    'general_capabilities',
    'system_prompt_compiled',
  ];

  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  const { error } = await getAdmin().from('agents').update(updates).eq('id', params.agentId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await compileAndSaveSystemPrompt(params.agentId);
  return NextResponse.json({ success: true });
}
