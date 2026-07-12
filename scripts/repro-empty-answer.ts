import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
process.env.LOG_GEMINI_RAW = '1';

import { createClient } from '@supabase/supabase-js';
import { runAgentTurn } from '../lib/server/ai/orchestrator';

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const admin = createClient(supabaseUrl ?? '', supabaseKey ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const agentId = '1469465d-418d-44ac-9751-a304666e6dc4';
  const { data: agent, error: agentError } = await admin
    .from('agents')
    .select('system_prompt_compiled')
    .eq('id', agentId)
    .single();
  if (agentError || !agent) throw agentError || new Error('agent not found');

  const { data: conversations, error: convError } = await admin
    .from('conversations')
    .select('id')
    .eq('agent_id', agentId)
    .order('started_at', { ascending: false })
    .limit(1);
  if (convError || !conversations?.length) throw convError || new Error('no conversations');

  const conversationId = conversations[0].id;
  const { data: messages, error: msgError } = await admin
    .from('messages')
    .select('sender, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (msgError) throw msgError;

  const history = (messages ?? [])
    .filter((m) => Boolean(m.content))
    .slice(0, -1)
    .map((m) => ({ role: (m.sender === 'user' ? 'user' : 'model') as 'user' | 'model', text: String(m.content) }));

  const userMessage = 'алы тапсырып кормедым негызы курстын багасы канша?';
  const result = await runAgentTurn(agentId, agent.system_prompt_compiled || '', userMessage, history);
  console.log('RESULT', JSON.stringify({ answer: result.answer, toolsUsed: result.toolsUsed }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});