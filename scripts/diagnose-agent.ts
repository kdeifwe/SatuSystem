import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
process.env.LOG_GEMINI_RAW = '1';

import { createAdminClient } from '@/lib/supabase/admin';
import { runAgentTurn, type ChatMessage } from '@/lib/server/ai/orchestrator';
import { searchKnowledgeBase } from '@/lib/knowledge-base/search';

async function main() {
  const agentId = '1469465d-418d-44ac-9751-a304666e6dc4';
  const admin = createAdminClient();

  const { data: agent, error: agentError } = await admin
    .from('agents')
    .select('id, name, dialogue_flow, system_prompt_compiled, general_capabilities, org_id')
    .eq('id', agentId)
    .single();

  if (agentError || !agent) {
    console.error('Agent fetch failed', agentError);
    process.exit(1);
  }

  console.log('=== AGENT META ===');
  console.log(JSON.stringify({ id: agent.id, name: agent.name, org_id: agent.org_id, general_capabilities: agent.general_capabilities }, null, 2));
  console.log('=== DIALOGUE_FLOW ===');
  console.log(JSON.stringify(agent.dialogue_flow, null, 2));
  console.log('=== SYSTEM_PROMPT_COMPILED SNIPPET ===');
  if (typeof agent.system_prompt_compiled === 'string') {
    const lines = agent.system_prompt_compiled.split(/\r?\n/);
    const start = Math.max(0, lines.findIndex((line) => /dialogue|воронки|шаг|STEP/i.test(line)) - 5);
    const end = Math.min(lines.length, start + 120);
    console.log(lines.slice(start, end).join('\n'));
  } else {
    console.log('No compiled prompt present for this agent.');
  }

  console.log('\n=== RUN TURN 1 ===');
  const first = await runAgentTurn(agentId, agent.system_prompt_compiled || '', 'саламатсызба курс канша?', []);
  console.log(JSON.stringify({ answer: first.answer, toolsUsed: first.toolsUsed, tokensInput: first.tokensInput, tokensOutput: first.tokensOutput }, null, 2));

  console.log('\n=== RUN TURN 2 WITH HISTORY ===');
  const history: ChatMessage[] = [
    { role: 'user', text: 'саламатсызба курс канша?' },
    { role: 'model', text: first.answer },
  ];
  const second = await runAgentTurn(agentId, agent.system_prompt_compiled || '', 'кыдыралы 11', history);
  console.log(JSON.stringify({ answer: second.answer, toolsUsed: second.toolsUsed, tokensInput: second.tokensInput, tokensOutput: second.tokensOutput }, null, 2));

  console.log('\n=== DIRECT KB SEARCH ===');
  const kbQuery = 'цена курс баға';
  const kbResults = await searchKnowledgeBase(agentId, kbQuery, 10);
  console.log(JSON.stringify({ query: kbQuery, count: kbResults.length, top: kbResults.slice(0, 5).map((r) => ({ content: r.content.slice(0, 200), similarity: r.similarity, priority: r.priority })) }, null, 2));

  console.log('\n=== DIRECT SQL PRICE CHECK ===');
  const { data: priceChunks, error: priceError } = await admin
    .from('kb_chunks')
    .select('id, content, metadata')
    .eq('agent_id', agentId)
    .or("content.ilike.%цена%,content.ilike.%курс%,content.ilike.%баға%")
    .limit(20);
  if (priceError) {
    console.error('Price chunk SQL fetch failed', priceError);
  } else {
    console.log(JSON.stringify({ count: priceChunks?.length ?? 0, examples: (priceChunks ?? []).map((chunk) => ({ id: chunk.id, preview: String(chunk.content).slice(0, 200) })) }, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
