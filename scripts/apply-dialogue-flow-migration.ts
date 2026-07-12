import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { convertDialogueFlowForMigration } from '../lib/funnel/dialogue-flow-migration.ts';
import { normalizeFunnelFlow } from '../lib/funnel/normalize.ts';
import type { DialogueFlowLike } from '../lib/funnel/dialogue-flow-migration.ts';

dotenv.config({ path: '.env.local' });

const DEFAULT_TARGET_AGENT_IDS = ['a34feb87-b49b-4990-97e8-38c111f9fa96', '1469465d-418d-44ac-9751-a304666e6dc4'];
const THIRD_AGENT_ID = '89e12d9f-0cc7-45ce-893a-a6690916b209';
const RECOVERY_LOG_PATH = process.env.MIGRATION_RECOVERY_LOG_PATH ?? path.resolve(process.cwd(), '.migration-recovery-log.jsonl');

interface AgentRow {
  id: string;
  name: string;
  dialogue_flow: unknown;
}

interface ConversionPlan {
  agent: AgentRow;
  conversion: ReturnType<typeof convertDialogueFlowForMigration>;
  beforeJson: string;
  afterJson: string;
  beforeSummary: { nodeCount: number; entryNodeId: string | null };
  afterSummary: { nodeCount: number; entryNodeId: string | null };
  diff: string;
}

function parseArgs(argv: string[]) {
  const options = { dryRun: false, confirm: false, explicitAgentIds: [] as string[] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--confirm') {
      options.confirm = true;
    } else if (arg === '--agent-id') {
      const nextValue = argv[index + 1];
      if (nextValue) {
        options.explicitAgentIds.push(nextValue);
        index += 1;
      }
    }
  }

  if (process.env.DRY_RUN === 'true' || process.env.DRY_RUN === '1') {
    options.dryRun = true;
  }

  const envAgentIds = (process.env.MIGRATION_TARGET_AGENT_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  options.explicitAgentIds.push(...envAgentIds);

  return options;
}

function summarizeFlow(flow: unknown) {
  const candidate = (flow && typeof flow === 'object' ? flow : {}) as Record<string, unknown>;
  const nodes = Array.isArray(candidate.nodes) ? candidate.nodes : [];
  return {
    nodeCount: nodes.length,
    entryNodeId: typeof candidate.entryNodeId === 'string' && candidate.entryNodeId.trim() ? candidate.entryNodeId : null,
  };
}

function toJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function isValidDialogueFlowLike(value: unknown): value is DialogueFlowLike {
  return normalizeFunnelFlow(value) !== null;
}

function createSimpleDiff(before: string, after: string) {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const diffLines: string[] = ['--- before', '+++ after'];

  const maxLength = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < maxLength; index += 1) {
    const beforeLine = beforeLines[index];
    const afterLine = afterLines[index];

    if (beforeLine === afterLine) {
      diffLines.push(`  ${beforeLine ?? ''}`);
      continue;
    }

    if (beforeLine !== undefined) {
      diffLines.push(`- ${beforeLine}`);
    }

    if (afterLine !== undefined) {
      diffLines.push(`+ ${afterLine}`);
    }
  }

  return diffLines.join('\n');
}

function printDryRunPlan(plan: ConversionPlan) {
  console.log(`\n=== ${plan.agent.name} (${plan.agent.id}) ===`);
  console.log(`[dry-run] old summary: nodes=${plan.beforeSummary.nodeCount}, entryNodeId=${plan.beforeSummary.entryNodeId ?? 'none'}`);
  console.log('[dry-run] old dialogue_flow:');
  console.log(plan.beforeJson);
  console.log('[dry-run] converted flow:');
  console.log(plan.afterJson);
  console.log('[dry-run] diff:');
  console.log(plan.diff);
}

async function appendManualRecoveryRecord(agentId: string, agentName: string, originalDialogueFlow: unknown, reason: string) {
  const record = {
    created_at: new Date().toISOString(),
    agent_id: agentId,
    agent_name: agentName,
    reason,
    stage: 'backup_insert_failed_and_rollback_failed',
    original_dialogue_flow: originalDialogueFlow,
    recovery_log_path: RECOVERY_LOG_PATH,
  };

  await mkdir(path.dirname(RECOVERY_LOG_PATH), { recursive: true });
  await appendFile(RECOVERY_LOG_PATH, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

async function promptForConfirmation() {
  if (!process.stdin.isTTY) {
    throw new Error('Confirmation required. Re-run with --confirm or --dry-run first.');
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('Type YES to apply these migrations: ')).trim();
    if (answer !== 'YES') {
      throw new Error('Confirmation rejected.');
    }
  } finally {
    rl.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dryRun = options.dryRun;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const targetAgentIds = Array.from(new Set([...DEFAULT_TARGET_AGENT_IDS, ...options.explicitAgentIds]));

  if (options.explicitAgentIds.length > 0) {
    console.log(`[apply-dialogue-flow-migration] explicit agent IDs requested: ${options.explicitAgentIds.join(', ')}`);
  }

  const { data, error } = await admin
    .from('agents')
    .select('id, name, dialogue_flow')
    .in('id', targetAgentIds)
    .order('name');

  if (error) {
    throw error;
  }

  const agents = (data ?? []) as AgentRow[];

  if (agents.length !== targetAgentIds.length) {
    const known = agents.map((row) => `${row.name} (${row.id})`);
    throw new Error(`Expected ${targetAgentIds.length} target agents, found ${agents.length}: ${known.join(', ') || 'none'}`);
  }

  const plans: ConversionPlan[] = [];
  for (const agent of agents) {
    if (!isValidDialogueFlowLike(agent.dialogue_flow)) {
      console.warn(`[apply-dialogue-flow-migration] Skipping agent ${agent.name} (${agent.id}): dialogue_flow is missing or not a valid funnel shape`);
      continue;
    }

    const conversion = convertDialogueFlowForMigration(agent.dialogue_flow, agent.name);
    if (!conversion.flow.nodes.length) {
      throw new Error(`No converted nodes for agent ${agent.name}`);
    }

    const beforeJson = toJson(agent.dialogue_flow);
    const afterJson = toJson(conversion.flow);
    const beforeSummary = summarizeFlow(agent.dialogue_flow);
    const afterSummary = summarizeFlow(conversion.flow);
    const diff = createSimpleDiff(beforeJson, afterJson);

    plans.push({
      agent,
      conversion,
      beforeJson,
      afterJson,
      beforeSummary,
      afterSummary,
      diff,
    });
  }

  if (dryRun) {
    console.log('[dry-run] No database writes will be performed.');
    for (const plan of plans) {
      printDryRunPlan(plan);
    }

    console.log('\n[dry-run] Summary:');
    console.log(JSON.stringify(plans.map((plan) => ({ id: plan.agent.id, name: plan.agent.name, before: plan.beforeSummary, after: plan.afterSummary })), null, 2));
    return;
  }

  if (!options.confirm) {
    await promptForConfirmation();
  }

  const results: Array<{ id: string; name: string; status: 'applied' | 'rolled_back' | 'failed'; error?: string }> = [];
  const appliedPlans: Array<{ id: string; name: string; originalDialogueFlow: unknown }> = [];
  let hadFailure = false;

  for (const plan of plans) {
    const originalDialogueFlow = plan.agent.dialogue_flow;

    try {
      const { error: updateError } = await admin
        .from('agents')
        .update({ dialogue_flow: plan.conversion.flow })
        .eq('id', plan.agent.id);

      if (updateError) {
        throw updateError;
      }

      const backupSnapshot = {
        dialogue_flow: originalDialogueFlow,
        migrated_from: plan.agent.name,
        migrated_at: new Date().toISOString(),
      };

      const { error: versionError } = await admin.from('agent_versions').insert({
        agent_id: plan.agent.id,
        snapshot: backupSnapshot,
        change_note: `Phase B dialogue_flow migration for ${plan.agent.name}`,
        created_by: null,
      });

      if (versionError) {
        const { error: rollbackError } = await admin
          .from('agents')
          .update({ dialogue_flow: originalDialogueFlow })
          .eq('id', plan.agent.id);

        if (rollbackError) {
          const recoveryRecord = await appendManualRecoveryRecord(
            plan.agent.id,
            plan.agent.name,
            originalDialogueFlow,
            `backup insert failed: ${versionError.message}; rollback failed: ${rollbackError.message}`,
          );

          console.error(`[manual-recovery-required] ${plan.agent.name} (${plan.agent.id}) needs manual recovery.`);
          console.error(JSON.stringify(recoveryRecord, null, 2));
          throw new Error(`Backup insert failed and rollback also failed. Manual recovery record written to ${RECOVERY_LOG_PATH}`);
        }

        throw versionError;
      }

      appliedPlans.push({ id: plan.agent.id, name: plan.agent.name, originalDialogueFlow });
      results.push({ id: plan.agent.id, name: plan.agent.name, status: 'applied' });
      console.log(`[apply-dialogue-flow-migration] applied ${plan.agent.name}`);
    } catch (error) {
      hadFailure = true;
      const message = error instanceof Error ? error.message : String(error);
      results.push({ id: plan.agent.id, name: plan.agent.name, status: 'failed', error: message });
      console.error(`[apply-dialogue-flow-migration] failed ${plan.agent.name}: ${message}`);
      break;
    }
  }

  if (hadFailure && appliedPlans.length > 0) {
    console.log('[apply-dialogue-flow-migration] rolling back already-applied agents:');
    for (const appliedPlan of appliedPlans) {
      const { error: rollbackError } = await admin
        .from('agents')
        .update({ dialogue_flow: appliedPlan.originalDialogueFlow })
        .eq('id', appliedPlan.id);

      if (rollbackError) {
        console.error(`[apply-dialogue-flow-migration] rollback failed for ${appliedPlan.name}: ${rollbackError.message}`);
        results.push({ id: appliedPlan.id, name: appliedPlan.name, status: 'failed', error: `rollback failed: ${rollbackError.message}` });
        continue;
      }

      results.push({ id: appliedPlan.id, name: appliedPlan.name, status: 'rolled_back' });
      console.log(`[apply-dialogue-flow-migration] rolled back ${appliedPlan.name}`);
    }
  }

  console.log('\n[apply-dialogue-flow-migration] final status:');
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
