import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { enqueueNotification } from '@/lib/notifications';

const AUTH_HEADER = 'authorization';

/**
 * Monitors for leads where AI hasn't responded for too long
 * Triggered by cron every 2 minutes
 */
export async function GET(req: NextRequest) {
  const token = req.headers.get(AUTH_HEADER)?.replace('Bearer ', '').trim();
  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  try {
    // Find agents with telegram_notifications enabled
    const { data: extensions, error: extError } = await admin
      .from('extension_settings')
      .select('agent_id, config')
      .eq('extension_type', 'telegram_notifications')
      .eq('is_active', true);

    if (extError) {
      console.error('[ai-silent-check] Error fetching extensions:', extError);
      return NextResponse.json({ error: extError.message }, { status: 500 });
    }

    const agentIdToConfig = new Map();
    for (const ext of extensions ?? []) {
      const config = ext.config as any;
      if (config?.events?.ai_silent?.enabled) {
        agentIdToConfig.set(ext.agent_id, config.events.ai_silent);
      }
    }

    if (agentIdToConfig.size === 0) {
      return NextResponse.json({ processed: 0, reason: 'No agents with ai_silent enabled' });
    }

    const results = [] as Array<{
      lead_id: string;
      agent_id: string;
      waiting_minutes: number;
      notified: boolean;
    }>;

    // Check each agent
    for (const [agentId, aiSilentConfig] of agentIdToConfig) {
      const thresholdMinutes = aiSilentConfig.threshold_minutes ?? 5;

      // Find leads with pending user messages without AI/operator response
      const { data: leads, error: leadsError } = await admin.rpc('find_ai_silent_leads', {
        p_agent_id: agentId,
        p_threshold_minutes: thresholdMinutes,
      });

      if (leadsError) {
        console.warn('[ai-silent-check] Error fetching leads for agent', agentId, leadsError);
        continue;
      }

      // For each lead, enqueue notification
      for (const lead of leads ?? []) {
        try {
          const notified = await enqueueNotification(
            'ai_silent',
            lead.lead_id,
            agentId,
            {
              lead_name: lead.lead_name || '—',
              last_message_preview: lead.last_message_preview || '—',
              waiting_minutes: Math.floor(lead.waiting_minutes) || thresholdMinutes,
            },
            { skipDedupCheck: false }
          );

          results.push({
            lead_id: lead.lead_id,
            agent_id: agentId,
            waiting_minutes: lead.waiting_minutes,
            notified,
          });
        } catch (err) {
          console.error('[ai-silent-check] Error enqueueing notification:', err);
          results.push({
            lead_id: lead.lead_id,
            agent_id: agentId,
            waiting_minutes: lead.waiting_minutes,
            notified: false,
          });
        }
      }
    }

    return NextResponse.json({ processed: results.length, results });
  } catch (error) {
    console.error('[ai-silent-check] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
