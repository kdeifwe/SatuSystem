import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
// Use a stable Gemini model for this diagnostic run to reduce preview timeouts
process.env.GEMINI_CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash';

async function main() {
  const { runAgentTurn } = await import('../lib/ai/orchestrator.ts');
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const agentId = '89e12d9f-0cc7-45ce-893a-a6690916b209';
  const { data: agent, error: agentError } = await admin.from('agents').select('org_id,system_prompt_compiled,general_capabilities').eq('id', agentId).single();
  if (agentError || !agent) {
    throw agentError || new Error('Agent not found');
  }

  const externalId = `sandbox:${agentId}`;
  let { data: lead, error: leadError } = await admin.from('leads').select('id').eq('external_id', externalId).single();
  if (leadError) throw leadError;
  if (!lead) {
    const { data: createdLead, error: createError } = await admin.from('leads').insert({
      org_id: agent.org_id,
      external_id: externalId,
      name: 'Sandbox lead',
      ai_enabled: true,
    }).select('id').single();
    if (createError) throw createError;
    lead = createdLead;
  }

  let { data: conv, error: convErr } = await admin.from('conversations').select('id,current_funnel_step').eq('lead_id', lead.id).eq('agent_id', agentId).limit(1).maybeSingle();
  if (convErr) throw convErr;
  if (!conv) {
    const { data: createdConv, error: createConvErr } = await admin.from('conversations').insert({ lead_id: lead.id, agent_id: agentId }).select('id,current_funnel_step').single();
    if (createConvErr) throw createConvErr;
    conv = createdConv;
  }

  await admin.from('conversations').update({ current_funnel_step: 'step-9' }).eq('id', conv.id);
  const msg1 = 'Клиент говорит, что дорого. Уточни у него, интересна ли рассрочка, и проверь через базу знаний точные условия рассрочки на 3/6/12 месяцев для этой модели.';
  const result1 = await runAgentTurn(agentId, agent.system_prompt_compiled || '', msg1, []);

  console.log('=== STEP-9 RESULT ===');
  console.log(JSON.stringify({ answer: result1.answer, toolsUsed: result1.toolsUsed }, null, 2));
  console.log('');

  await admin.from('conversations').update({ current_funnel_step: 'step-5' }).eq('id', conv.id);
  const msg2 = 'Клиент уже назвал бюджет 150000 тенге и спросил про рассрочку — найди в базе знаний условия рассрочки И одновременно поставь пометку в заметках лида "обсуждает бюджет 150000 тенге".';
  const result2 = await runAgentTurn(agentId, agent.system_prompt_compiled || '', msg2, []);

  console.log('=== MULTI-TOOL RESULT ===');
  console.log(JSON.stringify({ answer: result2.answer, toolsUsed: result2.toolsUsed }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
