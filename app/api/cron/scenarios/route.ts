import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runScenariosForLead } from '@/lib/server/scenarios/engine';

const AUTH_HEADER = 'authorization';

export async function GET(req: NextRequest) {
  const token = req.headers.get(AUTH_HEADER)?.replace('Bearer ', '').trim();
  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const { data: messages, error } = await admin
    .from('messages')
    .select('conversation_id, created_at, sender, conversation!inner(lead_id)')
    .eq('sender', 'user')
    .lte('created_at', cutoff)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const leadLastMessage: Record<string, string> = {};
  for (const message of messages ?? []) {
    const leadId = (message as any).conversation?.lead_id;
    if (!leadId || leadLastMessage[leadId]) continue;
    leadLastMessage[leadId] = message.created_at;
  }

  const leadIds = Object.keys(leadLastMessage);
  const results = [] as Array<{ leadId: string; processed: number; error?: string }>;

  for (const leadId of leadIds) {
    try {
      const runResult = await runScenariosForLead(leadId, 'no_reply_check');
      results.push({ leadId, processed: runResult.processed });
    } catch (error) {
      results.push({
        leadId,
        processed: 0,
        error: String(error instanceof Error ? error.message : error),
      });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
