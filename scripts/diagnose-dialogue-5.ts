import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
process.env.LOG_GEMINI_RAW = '1';

import { createAdminClient } from '../lib/supabase/admin';
import { runAgentTurn } from '../lib/server/ai/orchestrator';

async function main() {
  const agentId = '1469465d-418d-44ac-9751-a304666e6dc4';
  const admin = createAdminClient();

  const { data: agent, error: agentError } = await admin
    .from('agents')
    .select('id, name, system_prompt_compiled')
    .eq('id', agentId)
    .single();

  if (agentError || !agent) {
    throw new Error(`Agent fetch failed: ${JSON.stringify(agentError)}`);
  }

  console.log(`[DIAG] Agent ${agentId} ${agent.name}`);

  const turns = [
    'Сәлеметсіз бе! Курс туралы ақпарат білгім келеді. ID: 34603(Текстті өшірмеңіз, маңызды!)',
    'Қыдырәлі он бір',
    'дкт куык заңгер',
    'жо',
  ];

  const history: Array<{ role: 'user' | 'model'; text: string }> = [];

  for (let i = 0; i < turns.length; i++) {
    const userMessage = turns[i];
    console.log(`[DIAG] USER -> ${userMessage}`);
    const result = await runAgentTurn(agentId, agent.system_prompt_compiled || '', userMessage, history as any);
    console.log(`[DIAG] TURN ${i + 1} ANSWER:`, result.answer);
    console.log(`[DIAG] TOOLS USED:`, JSON.stringify({ toolsUsed: result.usedChunks || null, retrievalDebug: result.retrievalDebug ?? null }, null, 2));

    history.push({ role: 'user', text: userMessage });
    history.push({ role: 'model', text: result.answer });
  }

  // fetch recent ai_call_logs for the agent's sandbox conversation (if present)
  try {
    const { data: convs } = await admin.from('conversations').select('id').eq('lead_id', `sandbox:${agentId}`).limit(1);
    const convId = convs?.[0]?.id;
    if (convId) {
      const { data: logs } = await admin
        .from('ai_call_logs')
        .select('*')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true })
        .limit(20);
      console.log('\n=== AI_CALL_LOGS FOR SANDBOX CONVERSATION ===');
      for (const l of logs ?? []) {
        console.log('\n- id:', l.id, '\n  request:', JSON.stringify(l.request, null, 2), '\n  response_final:', l.response?.final ? JSON.stringify(l.response.final, null, 2) : JSON.stringify(l.response));
      }
    }
  } catch (err) {
    console.warn('Failed to fetch ai_call_logs', err);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
