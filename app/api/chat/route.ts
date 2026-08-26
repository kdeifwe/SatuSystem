import { NextRequest, NextResponse } from 'next/server';
import { createClient, getServerUser } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runAgentTurn } from '@/lib/server/ai/orchestrator';
import { splitAgentMessage, calculateTypingDelay } from '@/lib/server/ai/message-splitter';

export async function POST(req: NextRequest) {
  const supabase = createClient(req);
  const user = await getServerUser(supabase, req.headers.get('authorization') ?? undefined);
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

    const splitEnabled = Boolean(result.splitMessages ?? true);
    const messageParts = Array.isArray(result.messageParts) && result.messageParts.length > 0
      ? result.messageParts
      : splitAgentMessage(result.answer, splitEnabled, 3).map((part) => ({
        text: part.text,
        delayMs: calculateTypingDelay(part.text),
      }));

    return NextResponse.json({ ...result, messageParts });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
