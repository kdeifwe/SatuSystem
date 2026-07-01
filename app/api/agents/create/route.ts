import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { GEMINI_CHAT_MODEL } from '@/lib/server/ai/gemini-client';

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

    // Создаём агента
    const { data, error } = await supabase
      .from('agents')
      .insert({
        name: 'Новый агент',
        role: 'assistant',
        goal: 'Помощник',
        org_id: membership.org_id,
        model: GEMINI_CHAT_MODEL,
        is_active: true,
      })
      .select('id')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ agentId: data.id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
