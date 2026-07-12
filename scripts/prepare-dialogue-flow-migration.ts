import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { convertDialogueFlowForMigration } from '../lib/funnel/dialogue-flow-migration.ts';
import { normalizeFunnelFlow } from '../lib/funnel/normalize.ts';
import type { DialogueFlowLike } from '../lib/funnel/dialogue-flow-migration.ts';

dotenv.config({ path: '.env.local' });

interface AgentRow {
  id: string;
  name: string;
  dialogue_flow: unknown;
}

function isValidDialogueFlowLike(value: unknown): value is DialogueFlowLike {
  return normalizeFunnelFlow(value) !== null;
}

function buildPreviewMarkdown(agents: AgentRow[], reviewEntries: Array<{ agentName: string; agentId: string; issue: string }>) {
  const sections = agents.map((agent) => {
    if (!isValidDialogueFlowLike(agent.dialogue_flow)) {
      return `
### ${agent.name} (${agent.id})
⚠️ Пропущен: dialogue_flow отсутствует или не имеет допустимой формы funnel.
`;
    }

    const conversion = convertDialogueFlowForMigration(agent.dialogue_flow, agent.name);
    const before = JSON.stringify(agent.dialogue_flow, null, 2);
    const after = JSON.stringify(conversion.flow, null, 2);
    const lengthSummary = conversion.textLengthSummary
      .map((entry) => `- ${entry.nodeId}: source=${entry.sourceLength} rendered=${entry.renderedLength} delta=${entry.delta} (${entry.status})`)
      .join('\n');

    const issuesBlock = conversion.issues.length > 0
      ? `
Проблемы миграции:
${conversion.issues.map((issue) => `- ${issue}`).join('\n')}
`
      : '\nПроблемы миграции: отсутствуют\n';

    return `
### ${agent.name} (${agent.id})
${issuesBlock}
Сводка по длине текста узлов:
${lengthSummary || '- нет данных'}

Было:
\`\`\`json
${before}
\`\`\`

Стало:
\`\`\`json
${after}
\`\`\`
`;
  });

  const reviewSection = reviewEntries.length > 0
    ? reviewEntries.map((entry) => `- ${entry.agentName} (${entry.agentId}): ${entry.issue}`).join('\n')
    : '- Спорных меток не найдено.';

  return `# Preview: migration of dialogue_flow

## Список агентов, которые будут затронуты миграцией
${agents.map((agent) => `- ${agent.name} (${agent.id})`).join('\n')}

## Diff по каждому агенту
${sections.join('\n')}

## Сводка по спорным меткам
${reviewSection}
`;
}

function buildReviewMarkdown(reviewEntries: Array<{ agentName: string; agentId: string; issue: string }>) {
  if (reviewEntries.length === 0) {
    return `# migration_review_needed

Спорных меток не обнаружено.`;
  }

  return `# migration_review_needed

${reviewEntries.map((entry) => `- ${entry.agentName} (${entry.agentId}): ${entry.issue}`).join('\n')}
`;
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data, error } = await admin
    .from('agents')
    .select('id, name, dialogue_flow')
    .not('dialogue_flow', 'is', null)
    .order('name');

  if (error) throw error;

  const agents = (data ?? []) as AgentRow[];
  const reviewEntries: Array<{ agentName: string; agentId: string; issue: string }> = [];

  agents.forEach((agent) => {
    if (!isValidDialogueFlowLike(agent.dialogue_flow)) {
      console.warn(`[migration-preview] Skipping agent ${agent.name} (${agent.id}): dialogue_flow is missing or not a valid funnel shape`);
      return;
    }

    const conversion = convertDialogueFlowForMigration(agent.dialogue_flow, agent.name);
    conversion.issues.forEach((issue) => {
      reviewEntries.push({
        agentName: agent.name,
        agentId: agent.id,
        issue,
      });
    });
  });

  const previewPath = path.resolve(process.cwd(), 'docs/dialogue_flow_migration_preview.md');
  const reviewPath = path.resolve(process.cwd(), 'docs/migration_review_needed.md');

  await fs.writeFile(previewPath, buildPreviewMarkdown(agents, reviewEntries), 'utf8');
  await fs.writeFile(reviewPath, buildReviewMarkdown(reviewEntries), 'utf8');

  console.log(`[migration-preview] wrote ${previewPath}`);
  console.log(`[migration-review] wrote ${reviewPath}`);
  console.log(`[migration-preview] agents=${agents.length} reviewEntries=${reviewEntries.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
