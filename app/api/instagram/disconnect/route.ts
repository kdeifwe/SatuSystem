import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { disconnectInstagram } from '@/lib/channels/instagram-client';

export async function POST(req: NextRequest) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const agentId = typeof body?.agentId === 'string' ? body.agentId : null;

  if (!agentId) {
    return NextResponse.json({ error: 'agentId обязателен' }, { status: 400 });
  }

  try {
    const status = await disconnectInstagram(agentId);
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json({ status: 'disconnected', lastError: error instanceof Error ? error.message : 'Не удалось отключить Instagram' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
