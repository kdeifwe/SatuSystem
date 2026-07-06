import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildOrUpdateFlow } from '@/lib/funnel/builder';
import { compileAndSaveSystemPrompt } from '@/lib/ai/compile-system-prompt';
import { normalizeFunnelFlow } from '@/lib/funnel/normalize';
import type { FunnelFlow } from '@/lib/funnel/types';

function normalizeFlow(flow: unknown): FunnelFlow {
  return normalizeFunnelFlow(flow) ?? { nodes: [], edges: [], entryNodeId: '' };
}

export async function GET(_req: NextRequest, { params }: { params: { agentId: string } }) {
  const supabase = createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('agents')
    .select('dialogue_flow')
    .eq('id', params.agentId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ flow: normalizeFlow(data?.dialogue_flow ?? null) });
}

export async function POST(req: NextRequest, { params }: { params: { agentId: string } }) {
  const supabase = createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const body = await req.json();
  const admin = createAdminClient();
  const { data: agentData } = await admin
    .from('agents')
    .select('dialogue_flow')
    .eq('id', params.agentId)
    .single();

  try {
    const existingFlow = normalizeFlow(agentData?.dialogue_flow ?? null);
    const flow = await buildOrUpdateFlow(
      body.userMessage ?? '',
      Array.isArray(body.conversationHistory) ? body.conversationHistory : [],
      body.flow ? normalizeFlow(body.flow) : existingFlow,
    );

    return NextResponse.json({ flow });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось построить граф';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { agentId: string } }) {
  const supabase = createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const body = await req.json();
  const flow = normalizeFlow(body.flow);
  const admin = createAdminClient();

  const { data: existingAgent, error: loadError } = await admin
    .from('agents')
    .select('*')
    .eq('id', params.agentId)
    .single();

  if (loadError || !existingAgent) {
    return NextResponse.json({ error: 'Агент не найден' }, { status: 404 });
  }

  const { error: versionError } = await admin.from('agent_versions').insert({
    agent_id: params.agentId,
    snapshot: { ...existingAgent, dialogue_flow: flow },
    change_note: body.note ?? 'Обновление воронки продаж',
    created_by: user.id,
  });

  if (versionError) {
    return NextResponse.json({ error: versionError.message }, { status: 500 });
  }

  const { error: updateError } = await admin
    .from('agents')
    .update({ dialogue_flow: flow })
    .eq('id', params.agentId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const compiledPrompt = await compileAndSaveSystemPrompt(params.agentId);

  return NextResponse.json({ success: true, flow, compiledPrompt });
}
