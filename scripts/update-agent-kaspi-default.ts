import { createServiceClient } from '../lib/supabase/service.ts';

const agentId = '9b7cf5df-9055-4a14-a77c-e006a4454f5d';
const toolName = 'createKaspiInvoice';

async function main() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('agents')
    .select('id, general_capabilities')
    .eq('id', agentId)
    .single();

  if (error) {
    console.error('Failed to load agent:', error.message);
    process.exit(1);
  }

  const generalCapabilities = (data?.general_capabilities as Record<string, unknown> | null) ?? {};
  const allowedTools = Array.isArray(generalCapabilities.allowed_tools)
    ? generalCapabilities.allowed_tools.filter((tool): tool is string => typeof tool === 'string')
    : [];

  const newAllowedTools = Array.from(new Set([...allowedTools, toolName]));
  if (newAllowedTools.length === allowedTools.length && newAllowedTools.every((tool, index) => tool === allowedTools[index])) {
    console.log(`Agent ${agentId} already has ${toolName} in allowed_tools.`);
    console.log('current allowed_tools:', newAllowedTools);
    process.exit(0);
  }

  const { error: updateError } = await supabase
    .from('agents')
    .update({ general_capabilities: { ...generalCapabilities, allowed_tools: newAllowedTools } })
    .eq('id', agentId);

  if (updateError) {
    console.error('Failed to update agent:', updateError.message);
    process.exit(1);
  }

  console.log(`Updated agent ${agentId}.`);
  console.log('new allowed_tools:', newAllowedTools);
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
