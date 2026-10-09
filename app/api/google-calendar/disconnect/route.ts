import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseServer } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
  }

  const { agentId } = await req.json().catch(() => ({ agentId: null }));
  if (!agentId) {
    return NextResponse.json({ error: 'agentId обязателен' }, { status: 400 });
  }

  try {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { error } = await admin.from('calendar_connections').update({
      status: 'disconnected',
      updated_at: new Date().toISOString(),
      last_error: null,
    }).eq('agent_id', agentId);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Ошибка отключения Google Calendar' }, { status: 500 });
  }
}
