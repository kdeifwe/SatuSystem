import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

const AUTH_HEADER = 'authorization';

export async function GET(req: NextRequest) {
  const token = req.headers.get(AUTH_HEADER)?.replace('Bearer ', '').trim();
  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  try {
    // Find agents with repeat_touches enabled and their max_attempts
    const { data: extensions } = await admin
      .from('extension_settings')
      .select('agent_id, config')
      .eq('extension_type', 'telegram_notifications')
      .eq('is_active', true);

    const agentMax = new Map();
    for (const ext of extensions ?? []) {
      const cfg = ext.config as any;
      if (cfg?.events?.repeat_touches_exhausted?.enabled) {
        agentMax.set(ext.agent_id, cfg.events.repeat_touches_exhausted.max_attempts ?? 5);
      }
    }

    if (agentMax.size === 0) return NextResponse.json({ processed: 0 });

    let processed = 0;

    for (const [agentId, maxAttempts] of agentMax) {
      const { data: rows } = await admin
        .from('lead_repeat_touch_state')
        .select('lead_id, attempts_sent')
        .gte('attempts_sent', maxAttempts);

      for (const r of rows ?? []) {
        processed += 1;
        await admin.from('notification_log').insert({
          org_id: (await admin.from('agents').select('org_id').eq('id', agentId).maybeSingle()).data?.org_id,
          agent_id: agentId,
          lead_id: r.lead_id,
          event_type: 'repeat_touches_exhausted',
          payload: { lead_id: r.lead_id, max_attempts: r.attempts_sent },
          delivery_status: 'pending',
        });
      }
    }

    return NextResponse.json({ processed });
  } catch (e) {
    console.error('[repeat-touches cron] error', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
