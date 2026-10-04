import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { loginInstagram, getInstagramStatus } from '@/lib/channels/instagram-client';

export async function POST(req: NextRequest) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  return NextResponse.json({
    status: 'error',
    lastError: 'Подключение Instagram через логин/пароль отключено. Используйте официальный OAuth вход Instagram.',
  }, { status: 410 });
}

export async function GET(req: NextRequest) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const agentId = req.nextUrl.searchParams.get('agentId');
  if (!agentId) {
    return NextResponse.json({ status: 'disconnected' }, { status: 400 });
  }

  const status = await getInstagramStatus(agentId);
  return NextResponse.json(status);
}
