import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { submitInstagramCode } from '@/lib/channels/instagram-client';

export async function POST(req: NextRequest) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const agentId = typeof body?.agentId === 'string' ? body.agentId : null;
  const code = typeof body?.code === 'string' ? body.code.trim() : '';

  if (!agentId || !code) {
    return NextResponse.json({ error: 'agentId и code обязательны' }, { status: 400 });
  }

  try {
    const status = await submitInstagramCode(agentId, code);
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json({ status: 'error', lastError: error instanceof Error ? error.message : 'Не удалось подтвердить код Instagram' }, { status: 500 });
  }
}
