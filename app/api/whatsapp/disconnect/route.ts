import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { disconnectBaileysClient } from '@/lib/channels/baileys-client';

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
    const status = await disconnectBaileysClient(agentId);
    return NextResponse.json({ status: status.status });
  } catch (error) {
    return NextResponse.json({ error: 'Не удалось отключить WhatsApp' }, { status: 500 });
  }
}
