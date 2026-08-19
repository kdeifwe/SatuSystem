import 'dotenv/config';
import { createServiceClient } from '../lib/supabase/service.ts';
import { buildToolDeclarationsForAgent } from '../lib/ai/tools/registry.ts';

async function main() {
  const supabase = createServiceClient();
  const agentId = process.env.AGENT_ID ?? '1469465d-418d-44ac-9751-a304666e6dc4';
  const { data, error } = await supabase.from('agents').select('general_capabilities, dialogue_flow').eq('id', agentId).single();
  if (error || !data) {
    console.error('Failed to load agent', error?.message);
    process.exit(1);
  }
  const generalCapabilities = data.general_capabilities ?? {};
  const allowed = Array.isArray(generalCapabilities?.allowed_tools) ? generalCapabilities.allowed_tools : [];
  const decls = buildToolDeclarationsForAgent(allowed, generalCapabilities, data.dialogue_flow);
  console.log('Allowed tools from DB:', allowed);
  console.log('Declaration names:');
  for (const d of decls) console.log('-', d.name);
}

main().catch((e) => { console.error(e); process.exit(1); });
