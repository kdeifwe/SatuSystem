import 'dotenv/config';
import { createServiceClient } from '../lib/supabase/service.ts';
import { compileAndSaveSystemPrompt } from '../lib/ai/compile-system-prompt.ts';

async function main() {
  const supabase = createServiceClient();

  // Try to get agents with ai_enabled = true, fallback to all agents
  let { data: agents, error } = await supabase.from('agents').select('id').eq('ai_enabled', true);
  if (error) {
    console.warn('Failed to select ai_enabled agents, falling back to all agents', error.message);
    const res = await supabase.from('agents').select('id');
    agents = res.data ?? [];
  }

  if (!agents || agents.length === 0) {
    console.log('No agents found to compile prompts for.');
    return;
  }

  for (const agent of agents) {
    try {
      console.log('Compiling prompt for agent', agent.id);
      const compiled = await compileAndSaveSystemPrompt(agent.id);
      console.log('Compiled length', compiled.length);
    } catch (e) {
      console.error('Failed to compile for agent', agent.id, e instanceof Error ? e.message : e);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
