import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
  }

  const agentId = req.nextUrl.searchParams.get('agentId');
  if (!agentId) {
    return NextResponse.json({ error: 'agentId обязателен' }, { status: 400 });
  }

  try {
    // Получаем все источники для агента
    const { data, error } = await supabase
      .from('kb_sources')
      .select('id, title, type, status, file_size, error_message')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ sources: data });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
