import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runAgentTurn } from '@/lib/ai/orchestrator';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const { agentId, systemPrompt, message, history } = await req.json();
  if (!agentId || !message) {
    return NextResponse.json({ error: 'agentId и message обязательны' }, { status: 400 });
  }

  try {
    let finalSystemPrompt = systemPrompt;

    if (!finalSystemPrompt) {
      const admin = createAdminClient();
      const { data: agent } = await admin
        .from('agents')
        .select('system_prompt_compiled, name')
        .eq('id', agentId)
        .single();

      finalSystemPrompt =
        agent?.system_prompt_compiled ??
        `Ты ${agent?.name ?? 'ИИ-агент'}. Помогай пользователям.`;
    }

    const result = await runAgentTurn(
      agentId,
      finalSystemPrompt ?? '',
      message,
      history ?? [],
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
