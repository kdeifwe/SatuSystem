import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

async function main() {
  const [{ normalizeFunnelFlow }, { compileAndSaveSystemPrompt }] = await Promise.all([
    import('../lib/funnel/normalize.ts'),
    import('../lib/ai/compile-system-prompt.ts'),
  ]);

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: agents, error } = await admin
    .from('agents')
    .select('id, name, dialogue_flow')
    .not('dialogue_flow', 'is', null);

  if (error) throw error;

  const legacyAgents = (agents ?? []).filter((agent) => {
    const flow = agent.dialogue_flow as Record<string, unknown> | null;
    return Boolean(flow && Array.isArray(flow.sales_steps));
  });

  console.log(`[migrate] Found ${legacyAgents.length} agents with legacy dialogue_flow`);

  for (const agent of legacyAgents) {
    const normalized = normalizeFunnelFlow(agent.dialogue_flow);
    if (!normalized) {
      console.warn(`[migrate] Skip ${agent.id}: unable to normalize`);
      continue;
    }

    const { error: updateError } = await admin
      .from('agents')
      .update({ dialogue_flow: normalized })
      .eq('id', agent.id);

    if (updateError) {
      console.error(`[migrate] Failed for ${agent.id}: ${updateError.message}`);
      continue;
    }

    await admin.from('agent_versions').insert({
      agent_id: agent.id,
      snapshot: { id: agent.id, name: agent.name, dialogue_flow: normalized },
      change_note: 'Миграция legacy dialogue_flow в новый граф воронки',
      created_by: null,
    });

    await compileAndSaveSystemPrompt(agent.id);
    console.log(`[migrate] Updated ${agent.id} (${agent.name})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
