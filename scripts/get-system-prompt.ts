import 'dotenv/config';
import { createServiceClient } from '../lib/supabase/service.ts';

async function main() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('agents')
    .select('id,name,system_prompt_compiled')
    .eq('id','1469465d-418d-44ac-9751-a304666e6dc4')
    .single();
  if (error) {
    console.error('Supabase error:', error);
    process.exit(1);
  }
  console.log('AGENT:', data.id, data.name);
  console.log('--- system_prompt_compiled START ---');
  console.log(data.system_prompt_compiled ?? '(null)');
  console.log('--- system_prompt_compiled END ---');
}

main().catch((e) => { console.error(e); process.exit(1); });
