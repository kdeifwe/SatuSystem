import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { GEMINI_CHAT_MODEL } from '@/lib/server/ai/gemini-client';
import { compileAndSaveSystemPrompt } from '@/lib/ai/compile-system-prompt';

export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
  }

  try {
    // Получаем org_id из org_members
    const { data: membership } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'Организация не найдена' }, { status: 400 });
    }

    const { data: organization } = await supabase
      .from('organizations')
      .select('agent_defaults')
      .eq('id', membership.org_id)
      .single();

    const defaults = (organization?.agent_defaults as Record<string, unknown> | null) ?? {};
    const defaultAllowedTools = Array.isArray(defaults.default_allowed_tools)
      ? defaults.default_allowed_tools.filter((tool): tool is string => typeof tool === 'string')
      : ['searchKnowledgeBase', 'redirectToOperator', 'advanceFunnelStep', 'getCurrentDate', 'add_lead_note'];

    const initialCommunicationStyle = typeof defaults.human_communication_style === 'string'
      ? defaults.human_communication_style
      : null;
    const initialKnowledgeBasePrinciples = typeof defaults.knowledge_base_principles === 'string'
      ? defaults.knowledge_base_principles
      : null;

    const { data, error } = await supabase
      .from('agents')
      .insert({
        name: 'Новый агент',
        role: 'assistant',
        goal: 'Помощник',
        org_id: membership.org_id,
        model: GEMINI_CHAT_MODEL,
        is_active: true,
        human_communication_style: initialCommunicationStyle,
        knowledge_base_principles: initialKnowledgeBasePrinciples,
        general_capabilities: {
          allowed_tools: defaultAllowedTools,
        },
      })
      .select('id')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await compileAndSaveSystemPrompt(data.id);

    return NextResponse.json({ agentId: data.id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
