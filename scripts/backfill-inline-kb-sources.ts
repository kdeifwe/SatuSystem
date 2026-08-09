import dotenv from 'dotenv';
import { createAdminClient } from '../lib/supabase/admin.ts';
import { compileAndSaveSystemPrompt } from '../lib/ai/compile-system-prompt.ts';

dotenv.config({ path: '.env.local' });

const INLINE_KB_THRESHOLD = 18000;
const SAMAT_AGENT_ID = '9b7cf5df-9055-4a14-a77c-e006a4454f5d';

async function run() {
  const admin = createAdminClient();

  console.log('Starting kb_sources inline_in_prompt backfill...');
  const { data: sources, error: selectError } = await admin
    .from('kb_sources')
    .select('id, raw_content, inline_in_prompt, status, type, agent_id')
    .eq('type', 'manual')
    .eq('status', 'done');

  if (selectError) {
    if (selectError.message.includes('inline_in_prompt')) {
      throw new Error(
        'Failed to query kb_sources: database schema is missing inline_in_prompt. Apply the migration db/migrations/20260804170000_add_inline_in_prompt_to_kb_sources.sql before running this script.'
      );
    }
    throw new Error(`Failed to query kb_sources: ${selectError.message}`);
  }

  const toUpdate = (sources ?? [])
    .filter((source: any) =>
      source.inline_in_prompt !== true &&
      typeof source.raw_content === 'string' &&
      source.raw_content.trim().length > 0 &&
      source.raw_content.trim().length < INLINE_KB_THRESHOLD
    )
    .map((source: any) => source.id);

  console.log(`Found ${toUpdate.length} manual kb_sources to mark inline_in_prompt=true`);

  if (toUpdate.length > 0) {
    const { error: updateError } = await admin
      .from('kb_sources')
      .update({ inline_in_prompt: true })
      .in('id', toUpdate);

    if (updateError) {
      throw new Error(`Failed to update kb_sources inline_in_prompt: ${updateError.message}`);
    }

    console.log('Updated inline_in_prompt for manual kb_sources');
  }

  console.log('Disabling createKaspiInvoice for all agents with it enabled or allowed');
  const { data: agents, error: agentsError } = await admin
    .from('agents')
    .select('id, name, general_capabilities');

  if (agentsError) {
    throw new Error(`Failed to query agents: ${agentsError.message}`);
  }

  const agentsToUpdate = [] as Array<{ id: string; general_capabilities: Record<string, unknown> }>;

  for (const agent of agents ?? []) {
    const generalCapabilities = (agent.general_capabilities as Record<string, unknown> | null) ?? {};
    const currentTools = Array.isArray(generalCapabilities.allowed_tools)
      ? (generalCapabilities.allowed_tools as string[]).filter((tool) => typeof tool === 'string')
      : [];

    const hasCreateKaspi = currentTools.includes('createKaspiInvoice');
    const hasKaspiEnabled = generalCapabilities.kaspi_invoice_enabled === true;

    if (hasCreateKaspi || hasKaspiEnabled) {
      const nextTools = currentTools.filter((tool) => tool !== 'createKaspiInvoice');
      agentsToUpdate.push({
        id: agent.id,
        general_capabilities: {
          ...generalCapabilities,
          allowed_tools: nextTools,
          kaspi_invoice_enabled: false,
        },
      });
    }
  }

  console.log(`Found ${agentsToUpdate.length} agents to disable createKaspiInvoice for`);

  for (const agent of agentsToUpdate) {
    const { error: updateError } = await admin
      .from('agents')
      .update({ general_capabilities: agent.general_capabilities })
      .eq('id', agent.id);

    if (updateError) {
      throw new Error(`Failed to update agent ${agent.id}: ${updateError.message}`);
    }
  }

  console.log(`Recompiling system prompt for agent ${SAMAT_AGENT_ID}`);
  const compiled = await compileAndSaveSystemPrompt(SAMAT_AGENT_ID);
  console.log(`Compiled system prompt length: ${compiled.length}`);
  console.log('Backfill script finished successfully.');
}

run().catch((error) => {
  console.error('Backfill script failed:', error);
  process.exit(1);
});