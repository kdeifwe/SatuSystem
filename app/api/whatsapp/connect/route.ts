import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { getBaileysClient } from '@/lib/channels/baileys-client';
import { waitForBaileysStatus } from '@/lib/channels/baileys-status-wait';

export async function POST(req: NextRequest) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const bodyAgentId = body?.agentId;
  const queryAgentId = req.nextUrl.searchParams.get('agentId');
  const agentId = typeof bodyAgentId === 'string' ? bodyAgentId : queryAgentId;

  if (!agentId) {
    return NextResponse.json({ error: 'agentId обязателен' }, { status: 400 });
  }

  try {
    const clientEntry = await getBaileysClient(agentId);
    const finalStatus = await waitForBaileysStatus(
      () => clientEntry.status,
      ['qr', 'connected', 'error'],
      15000,
      250
    );

    const admin = (await import('@/lib/supabase/admin')).createAdminClient();
    const { data: agent } = await admin.from('agents').select('org_id').eq('id', agentId).single();
    const { data: channel } = await admin
      .from('channels')
      .select('id')
      .eq('org_id', agent?.org_id)
      .eq('type', 'whatsapp')
      .maybeSingle();

    return NextResponse.json({
      status: finalStatus ?? clientEntry.status,
      channelId: channel?.id ?? null,
      qrDataUrl: clientEntry.qrDataUrl ?? null,
      jid: clientEntry.jid ?? null,
      lastError: clientEntry.lastError ?? null,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Не удалось подключить WhatsApp' }, { status: 500 });
  }
}
