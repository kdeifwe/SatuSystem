import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { loginInstagram, getInstagramStatus } from '@/lib/channels/instagram-client';

export async function POST(req: NextRequest) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const agentId = typeof body?.agentId === 'string' ? body.agentId : null;
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!agentId || !username || !password) {
    return NextResponse.json({ error: 'agentId, username и password обязательны' }, { status: 400 });
  }

  try {
    const status = await loginInstagram(agentId, username, password);
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json({ status: 'error', lastError: error instanceof Error ? error.message : 'Не удалось подключить Instagram' }, { status: 500 });
  }
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
