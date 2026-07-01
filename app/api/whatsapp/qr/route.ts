import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { getBaileysStatus } from '@/lib/channels/baileys-client';

export async function GET(req: NextRequest) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const agentId = req.nextUrl.searchParams.get('agentId');
  if (!agentId) {
    return NextResponse.json({ qrDataUrl: null });
  }

  const status = await getBaileysStatus(agentId);
  return NextResponse.json({ qrDataUrl: status.qrDataUrl ?? null });
}
