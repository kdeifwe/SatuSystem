import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppText } from '@/lib/channels/baileys-client';
import { sendTelegramText } from '@/lib/channels/telegram-client';

const AUTH_HEADER = 'authorization';

export async function GET(req: NextRequest) {
  const token = req.headers.get(AUTH_HEADER)?.replace('Bearer ', '').trim();
  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: pendingRows, error } = await admin
    .from('notification_log')
    .select('id, org_id, agent_id, lead_id, payload, attempts')
    .eq('delivery_status', 'pending')
    .eq('event_type', 'scheduled_reminder')
    .lt('attempts', 5)
    .lte('sent_at', new Date().toISOString())
    .order('sent_at', { ascending: true })
    .limit(50);

  if (error) {
    console.error('[send-scheduled-reminders] failed to fetch pending rows', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results: Array<{ id: string; status: string; error?: string }> = [];

  for (const row of pendingRows ?? []) {
    try {
      if (!row.lead_id) {
        const nextAttempts = (row.attempts ?? 0) + 1;
        const deliveryStatus = nextAttempts >= 5 ? 'failed' : 'pending';
        await admin
          .from('notification_log')
          .update({ delivery_status: deliveryStatus, attempts: nextAttempts, last_error: 'missing lead_id' })
          .eq('id', row.id);

        results.push({ id: row.id, status: 'failed', error: 'missing lead_id' });
        continue;
      }

      const { data: lead, error: leadErr } = await admin
        .from('leads')
        .select('external_id, channel_id, channels(type)')
        .eq('id', row.lead_id)
        .maybeSingle();

      if (leadErr || !lead) {
        const nextAttempts = (row.attempts ?? 0) + 1;
        const deliveryStatus = nextAttempts >= 5 ? 'failed' : 'pending';
        await admin
          .from('notification_log')
          .update({ delivery_status: deliveryStatus, attempts: nextAttempts, last_error: 'lead not found' })
          .eq('id', row.id);

        results.push({ id: row.id, status: 'failed', error: 'lead not found' });
        continue;
      }

      const channelType = (lead as any)?.channels?.type;
      const externalId = (lead as any)?.external_id;
      const channelId = (lead as any)?.channel_id;

      if (!channelType || !externalId || !channelId) {
        const nextAttempts = (row.attempts ?? 0) + 1;
        const deliveryStatus = nextAttempts >= 5 ? 'failed' : 'pending';
        await admin
          .from('notification_log')
          .update({ delivery_status: deliveryStatus, attempts: nextAttempts, last_error: 'missing lead channel info' })
          .eq('id', row.id);

        results.push({ id: row.id, status: 'failed', error: 'missing lead channel info' });
        continue;
      }

      const content = String(row.payload?.message ?? '').trim();
      if (!content) {
        const nextAttempts = (row.attempts ?? 0) + 1;
        const deliveryStatus = nextAttempts >= 5 ? 'failed' : 'pending';
        await admin
          .from('notification_log')
          .update({ delivery_status: deliveryStatus, attempts: nextAttempts, last_error: 'empty payload.message' })
          .eq('id', row.id);

        results.push({ id: row.id, status: 'failed', error: 'empty payload.message' });
        continue;
      }

      try {
        if (channelType === 'whatsapp') {
          await sendWhatsAppText(row.agent_id, externalId, content);
        } else if (channelType === 'telegram') {
          await sendTelegramText(channelId, externalId, content);
        } else {
          throw new Error(`Unsupported channel type: ${channelType}`);
        }

        await admin
          .from('notification_log')
          .update({ delivery_status: 'sent', sent_at: new Date().toISOString(), attempts: (row.attempts ?? 0) + 1 })
          .eq('id', row.id);

        results.push({ id: row.id, status: 'sent' });
      } catch (sendErr) {
        const errorMessage = sendErr instanceof Error ? sendErr.message : String(sendErr);
        console.error('[send-scheduled-reminders] failed to send', { rowId: row.id, error: errorMessage });
        const nextAttempts = (row.attempts ?? 0) + 1;
        const deliveryStatus = nextAttempts >= 5 ? 'failed' : 'pending';

        await admin
          .from('notification_log')
          .update({ delivery_status: deliveryStatus, attempts: nextAttempts, last_error: errorMessage })
          .eq('id', row.id);

        results.push({ id: row.id, status: deliveryStatus, error: errorMessage });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('[send-scheduled-reminders] unexpected error', { rowId: row?.id, error: errorMessage });
      const nextAttempts = (row.attempts ?? 0) + 1;
      const deliveryStatus = nextAttempts >= 5 ? 'failed' : 'pending';

      await admin
        .from('notification_log')
        .update({ delivery_status: deliveryStatus, attempts: nextAttempts, last_error: errorMessage })
        .eq('id', row?.id);

      results.push({ id: row?.id ?? 'unknown', status: 'failed', error: errorMessage });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
