import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseServer } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: NextRequest) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const agentId = req.nextUrl.searchParams.get('agentId');
  if (!agentId) return NextResponse.json({ error: 'agentId обязателен' }, { status: 400 });

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data, error } = await admin.from('calendar_connections').select('*').eq('agent_id', agentId).maybeSingle();
  if (error) return NextResponse.json({ connected: false, status: 'disconnected' }, { status: 500 });

  if (!data) {
    return NextResponse.json({ connected: false, status: 'disconnected' });
  }

  return NextResponse.json({
    connected: data.status === 'connected',
    status: data.status ?? 'disconnected',
    google_email: data.google_email ?? null,
    needs_reauth: data.status === 'needs_reauth',
  });
}
