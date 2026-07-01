import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { getBaileysStatus } from '@/lib/channels/baileys-client';

export async function GET(req: NextRequest) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const agentId = req.nextUrl.searchParams.get('agentId');
  if (!agentId) {
    return NextResponse.json({ status: 'disconnected', channelId: null, qrDataUrl: null, jid: null, lastError: null });
  }

  const status = await getBaileysStatus(agentId);
  const admin = (await import('@/lib/supabase/admin')).createAdminClient();
  const { data: agent } = await admin.from('agents').select('org_id').eq('id', agentId).single();
  const { data: channel } = await admin
    .from('channels')
    .select('id')
    .eq('org_id', agent?.org_id)
    .eq('type', 'whatsapp')
    .maybeSingle();

  return NextResponse.json({
    status: status.status,
    channelId: channel?.id ?? null,
    qrDataUrl: status.qrDataUrl ?? null,
    jid: status.jid ?? null,
    lastError: status.lastError ?? null,
  });
}
