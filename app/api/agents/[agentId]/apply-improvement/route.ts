import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { applyPromptPatches, type PromptPatch } from '@/lib/server/ai/improve-agent';

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

  const body = await req.json();
  const { improved_prompt, patches, change_note, current_prompt } = body ?? {};
  if (!Array.isArray(patches) && typeof improved_prompt !== 'string') {
    return NextResponse.json({ error: 'Нужно передать patches или improved_prompt' }, { status: 400 });
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

  const snapshot = {
    ...agent,
    system_prompt_compiled: agent.system_prompt_compiled ?? null,
  };

  const { error: versionError } = await admin.from('agent_versions').insert({
    agent_id: params.agentId,
    snapshot,
    change_note: typeof change_note === 'string' && change_note.trim() ? change_note : 'Улучшение через чат',
    created_by: user.id,
  });

  if (versionError) {
    return NextResponse.json({ error: versionError.message }, { status: 500 });
  }

  const basePrompt = typeof current_prompt === 'string' && current_prompt.trim()
    ? current_prompt
    : (agent.system_prompt_compiled ?? `Ты ${agent.name}. Роль: ${agent.role}. Цель: ${agent.goal}.`);

  let finalPrompt = basePrompt;

  if (Array.isArray(patches)) {
    const normalizedPatches = patches.filter(
      (value): value is PromptPatch => Boolean(value) && typeof value === 'object' && typeof value.search === 'string' && typeof value.replace === 'string' && typeof value.reason === 'string'
    );

    if (normalizedPatches.length === 0) {
      return NextResponse.json({ error: 'Патчи не содержат валидных изменений' }, { status: 400 });
    }

    try {
      finalPrompt = applyPromptPatches(basePrompt, normalizedPatches);
    } catch (patchError) {
      const message = patchError instanceof Error ? patchError.message : String(patchError);
      return NextResponse.json({ error: `Не удалось применить патчи: ${message}` }, { status: 400 });
    }
  } else if (typeof improved_prompt === 'string' && improved_prompt.trim()) {
    finalPrompt = improved_prompt;
  }

  const { error: updateError } = await admin
    .from('agents')
    .update({ system_prompt_compiled: finalPrompt })
    .eq('id', params.agentId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
