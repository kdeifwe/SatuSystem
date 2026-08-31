import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertIsolatedSmartBroadcastTestContext, createIsolatedSmartBroadcastTestContext } from './smart-broadcast-test-utils';

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    return {
      ...(record.code ? { code: record.code } : {}),
      ...(record.message ? { message: record.message } : {}),
      ...(record.details ? { details: record.details } : {}),
      ...(record.hint ? { hint: record.hint } : {}),
      ...(record.stack ? { stack: record.stack } : {}),
    };
  }

  return error;
}

async function deleteById(admin: any, entity: string, id: string | undefined, label: string) {
  if (!id) {
    console.log(`[cleanup] no ${label} id, skipping ${entity}`);
    return;
  }

  try {
    const { error } = await admin.from(entity).delete().eq('id', id);
    if (error) {
      console.error(`[cleanup] failed to delete ${label} ${id}`, normalizeError(error));
      return;
    }

    console.log(`[cleanup] deleted ${label} ${id}`);
  } catch (error) {
    console.error(`[cleanup] unexpected error while deleting ${label} ${id}`, normalizeError(error));
  }
}

async function run() {
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

  const { createAdminClient } = await import('../lib/supabase/admin.ts');
  const { createLeadSignalRecord, generateSmartBroadcastMessage } = await import('../lib/smart-broadcasts/service.ts');

  const admin = createAdminClient();
  let context: Awaited<ReturnType<typeof createIsolatedSmartBroadcastTestContext>> | undefined;
  let leadId: string | undefined;
  let signalId: string | undefined;
  let agentId: string | undefined;
  let orgId: string | undefined;
  let mainError: unknown;

  try {
    context = await createIsolatedSmartBroadcastTestContext(admin, {
      orgName: `sb-live-token-proof-${Date.now()}`,
      agentName: 'sb-live-token-proof-agent',
      model: 'gemini-2.5-flash',
    });
    assertIsolatedSmartBroadcastTestContext(context);

    agentId = context.agentId;
    orgId = context.orgId;

    leadId = randomUUID();
    const { error: leadError } = await admin.from('leads').insert({
      id: leadId,
      org_id: orgId,
      external_id: `sb-live-token-proof-${Date.now()}`,
      name: 'Екатерина',
      ai_enabled: true,
      status: 'new',
    });
    if (leadError) throw new Error('Failed to create lead: ' + leadError.message);

    const signal = await createLeadSignalRecord({
      orgId,
      leadId,
      signalType: 'competitor_comparison',
      description: 'Хочет уточнить сроки и условия доставки',
      rawQuote: null,
    });
    signalId = signal.id;

    const result = await generateSmartBroadcastMessage({
      agentId,
      orgId,
      leadId,
      leadName: 'Екатерина',
      signal: {
        id: signal.id,
        lead_id: signal.lead_id,
        signal_type: signal.signal_type,
        description: signal.description,
        raw_quote: signal.raw_quote,
        status: signal.status,
        created_at: signal.created_at,
      },
      goalInstruction: 'Спроси, когда удобно обсудить доставку и уточнить стоимость',
      maxMessageLength: 220,
    });

    const { data: aiCalls, error: aiLogsError } = await admin
      .from('ai_call_logs')
      .select('id, tokens_input, tokens_output, created_at, request')
      .order('created_at', { ascending: false })
      .limit(5);

    if (aiLogsError) throw new Error(aiLogsError.message);

    const matching = (aiCalls ?? []).filter((entry: any) => entry?.request?.lead_id === leadId);

    console.log(JSON.stringify({
      generatedText: result.text,
      aiCallId: result.aiCallId,
      matchingAiLogs: matching.slice(0, 3),
    }, null, 2));
  } catch (error) {
    mainError = error;
    console.error('[run] test scenario failed', normalizeError(error));
  } finally {
    if (!agentId || !orgId) {
      console.log('[cleanup] no orgId/agentId for cleanup, skipping agent/org deletion');
    }

    if (!leadId && !signalId) {
      console.log('[cleanup] no leadId/signalId for cleanup, skipping lead/lead_signal deletion');
    }

    await deleteById(admin, 'lead_signals', signalId, 'lead_signals');
    await deleteById(admin, 'leads', leadId, 'leads');
    await deleteById(admin, 'agents', agentId, 'agents');
    await deleteById(admin, 'organizations', orgId, 'organizations');
  }

  if (mainError) throw mainError;
}

run().catch((error) => {
  console.error('[run] final failure', normalizeError(error));
  process.exit(1);
});
