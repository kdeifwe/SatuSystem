import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createAdminClient } from '../lib/supabase/admin.ts';

async function main() {
  const admin = createAdminClient();
  const agentId = '1469465d-418d-44ac-9751-a304666e6dc4';

  const { data: convs, error: convError } = await admin
    .from('conversations')
    .select('id, lead_id, agent_id, started_at')
    .eq('agent_id', agentId)
    .order('started_at', { ascending: false })
    .limit(10);

  if (convError) {
    console.error('Failed to query conversations', convError);
    process.exit(1);
  }

  console.log('Recent conversations:', convs?.map((c) => ({ id: c.id, lead_id: c.lead_id, started_at: c.started_at })));

  const { data: msgs, error: msgError } = await admin
    .from('messages')
    .select('id, conversation_id, sender, content, tool_calls, created_at')
    .eq('conversation_id', convs?.[0]?.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (msgError) {
    console.error('Failed to query messages', msgError);
    process.exit(1);
  }

  console.log('Recent messages in latest conversation:');
  for (const msg of (msgs ?? []).reverse()) {
    console.log(JSON.stringify({ id: msg.id, sender: msg.sender, content: msg.content, tool_calls: msg.tool_calls, created_at: msg.created_at }, null, 2));
  }

  const searchCalls = (msgs ?? [])
    .filter((msg) => msg.sender === 'user')
    .flatMap((msg) => Array.isArray(msg.tool_calls) ? msg.tool_calls : [])
    .filter((call: any) => call.name === 'searchKnowledgeBase');

  console.log('Aggregated searchKnowledgeBase tool calls from recent user messages:', JSON.stringify(searchCalls, null, 2));

  const { data: aiCalls, error: aiCallsError } = await admin
    .from('ai_call_logs')
    .select('id, conversation_id, request, response, created_at')
    .eq('conversation_id', convs?.[0]?.id)
    .order('created_at', { ascending: false })
    .limit(10);

  if (aiCallsError) {
    console.error('Failed to query ai_call_logs', aiCallsError);
    process.exit(1);
  }

  console.log('Recent ai_call_logs for latest conversation:');
  console.log(JSON.stringify(aiCalls, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

main().catch((error) => {
  console.error(error);
  process.exit(1);
});