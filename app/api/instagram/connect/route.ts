import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { getInstagramStatus, InstagramWorkerError, loginInstagram } from '@/lib/channels/instagram-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Вход выполняется через ig-worker: до ~2 минут, если Instagram просит подтверждение
export const maxDuration = 150;

export async function POST(req: NextRequest) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const agentId = typeof body?.agentId === 'string' ? body.agentId : null;
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!agentId || !username || !password) {
    return NextResponse.json({ status: 'error', lastError: 'agentId, логин и пароль обязательны' }, { status: 400 });
  }
  if (username.length > 64 || password.length > 256) {
    return NextResponse.json({ status: 'error', lastError: 'Слишком длинный логин или пароль' }, { status: 400 });
  }

  try {
    const status = await loginInstagram(agentId, username, password);
    return NextResponse.json(status);
  } catch (error) {
    // пароль и тело запроса не логируем
    if (error instanceof InstagramWorkerError) {
      return NextResponse.json({ status: 'error', lastError: error.message }, { status: error.httpStatus >= 500 ? 502 : error.httpStatus });
    }
    return NextResponse.json({ status: 'error', lastError: 'Не удалось подключить Instagram' }, { status: 500 });
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
