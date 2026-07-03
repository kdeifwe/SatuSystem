import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { enqueueNotification } from '@/lib/notifications';
import { getBaileysClient } from '@/lib/channels/baileys-client';

const AUTH_HEADER = 'authorization';
const DISCONNECT_THRESHOLD_SECONDS = 60; // Only alert if disconnected for >60 seconds

/**
 * Health check for WhatsApp connection
 * Monitors if connection has been down for longer than threshold
 * Acts as fallback if immediate disconnect notification is missed (e.g., process crash)
 * Triggered by cron every 1 minute
 */
export async function GET(req: NextRequest) {
  const token = req.headers.get(AUTH_HEADER)?.replace('Bearer ', '').trim();
  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  try {
    // Get all agents to check their WhatsApp status
    const { data: agents, error: agentsError } = await admin
      .from('agents')
      .select('id, org_id')
      .eq('is_active', true);

    if (agentsError || !agents) {
      console.error('[whatsapp-health-check] Error fetching agents:', agentsError);
      return NextResponse.json({ error: agentsError?.message || 'Failed to fetch agents' }, { status: 500 });
    }

    const results = {
      checked: 0,
      notified: 0,
      errors: [] as string[],
    };

    for (const agent of agents) {
      try {
        // Get the client to check current status
        const clientEntry = await getBaileysClient(agent.id).catch(() => null);

        if (!clientEntry || clientEntry.status !== 'disconnected') {
          results.checked += 1;
          continue;
        }

        // Check if disconnected long enough to warrant a notification
        const disconnectAge = clientEntry.lastDisconnectTime ? Date.now() - clientEntry.lastDisconnectTime : undefined;
        if (!disconnectAge || disconnectAge < DISCONNECT_THRESHOLD_SECONDS * 1000) {
          results.checked += 1;
          continue;
        }

        // Send notification (dedup will prevent double notification if sent <2min ago)
        const notified = await enqueueNotification('whatsapp_disconnected', null, agent.id, {
          reason: clientEntry.lastError || 'Connection down for extended period',
          timestamp: new Date().toISOString(),
          disconnectDurationSeconds: Math.floor(disconnectAge / 1000),
          source: 'health_check_cron',
        });

        if (notified) {
          results.notified += 1;
        }
        results.checked += 1;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.errors.push(`Agent ${agent.id}: ${errorMsg}`);
        console.error('[whatsapp-health-check] Error checking agent:', agent.id, err);
      }
    }

    return NextResponse.json({
      status: 'ok',
      checked: results.checked,
      notified: results.notified,
      errors: results.errors.length > 0 ? results.errors : undefined,
    });
  } catch (error) {
    console.error('[whatsapp-health-check] Unexpected error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
