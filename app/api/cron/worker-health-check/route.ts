import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { enqueueNotification } from '@/lib/notifications';

const AUTH_HEADER = 'authorization';

/**
 * Health check for message processing workers
 * Monitors if there are pending user messages but no recent AI processing
 * Triggered by cron every 15 minutes
 */
export async function GET(req: NextRequest) {
  const token = req.headers.get(AUTH_HEADER)?.replace('Bearer ', '').trim();
  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  try {
    // Find orgs with worker_down monitoring enabled
    const { data: extensions, error: extError } = await admin
      .from('extension_settings')
      .select('agent_id, config, agents!inner(org_id)')
      .eq('extension_type', 'telegram_notifications')
      .eq('is_active', true);

    if (extError) {
      console.error('[worker-health-check] Error fetching extensions:', extError);
      return NextResponse.json({ error: extError.message }, { status: 500 });
    }

    const orgIds = new Set<string>();
    for (const ext of extensions ?? []) {
      const config = ext.config as any;
      if (config?.events?.worker_down?.enabled) {
        const agent = (ext as any).agents;
        if (agent?.org_id) {
          orgIds.add(agent.org_id);
        }
      }
    }

    if (orgIds.size === 0) {
      return NextResponse.json({ processed: 0, reason: 'No orgs with worker_down monitoring' });
    }

    const results = [] as Array<{
      org_id: string;
      pending_count: number;
      last_activity_ago: number;
      notified: boolean;
    }>;

    // Check health for each org
    for (const orgId of orgIds) {
      try {
        // Get pending user messages
        const { data: pendingData, error: pendingError } = await admin
          .from('messages')
          .select('id, created_at, conversation!inner(lead_id, lead!inner(ai_enabled, ai_paused))')
          .eq('sender', 'user')
          .eq('conversation.lead.ai_enabled', true)
          .eq('conversation.lead.ai_paused', false)
          .gt('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
          .limit(1);

        if (pendingError) {
          console.warn('[worker-health-check] Error fetching pending messages:', pendingError);
          continue;
        }

        const pendingCount = pendingData?.length ?? 0;

        if (pendingCount === 0) {
          // No pending messages, health is fine
          results.push({
            org_id: orgId,
            pending_count: 0,
            last_activity_ago: 0,
            notified: false,
          });
          continue;
        }

        // Check for recent AI processing
        const { data: recentProcessing, error: procError } = await admin
          .from('ai_call_logs')
          .select('id, created_at')
          .gte('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
          .limit(1);

        if (procError) {
          console.warn('[worker-health-check] Error checking ai_call_logs:', procError);
          continue;
        }

        if ((recentProcessing ?? []).length > 0) {
          // Worker is active
          results.push({
            org_id: orgId,
            pending_count: pendingCount,
            last_activity_ago: 0,
            notified: false,
          });
          continue;
        }

        // Get last activity time
        const { data: lastActivityData, error: lastActError } = await admin
          .from('ai_call_logs')
          .select('created_at')
          .order('created_at', { ascending: false })
          .limit(1);

        const lastActivityMs = lastActivityData?.[0]?.created_at
          ? Date.now() - new Date(lastActivityData[0].created_at).getTime()
          : 15 * 60 * 1000;
        const lastActivityMins = Math.round(lastActivityMs / 60000);

        // Check if we already notified about this
        const { data: existingNotif } = await admin
          .from('notification_log')
          .select('id')
          .eq('event_type', 'worker_down')
          .eq('org_id', orgId)
          .gt('sent_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
          .limit(1);

        if ((existingNotif ?? []).length > 0) {
          // Already notified recently
          results.push({
            org_id: orgId,
            pending_count: pendingCount,
            last_activity_ago: lastActivityMins,
            notified: false,
          });
          continue;
        }

        // Worker is down - enqueue notification
        const notified = await enqueueNotification('worker_down', null, null, {
          pending_count: pendingCount,
          last_activity_ago: lastActivityMins,
        }, { orgId, skipDedupCheck: false });

        results.push({
          org_id: orgId,
          pending_count: pendingCount,
          last_activity_ago: lastActivityMins,
          notified,
        });
      } catch (err) {
        console.error('[worker-health-check] Error checking org:', orgId, err);
        results.push({
          org_id: orgId,
          pending_count: 0,
          last_activity_ago: 0,
          notified: false,
        });
      }
    }

    return NextResponse.json({ processed: results.length, results });
  } catch (error) {
    console.error('[worker-health-check] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
