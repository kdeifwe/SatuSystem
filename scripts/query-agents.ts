import 'dotenv/config';
import { createServiceClient } from '../lib/supabase/service.ts';

async function main() {
  const supabase = createServiceClient();
  const ids = ['1469465d-418d-44ac-9751-a304666e6dc4','9b7cf5df-9055-4a14-a77c-e006a4454f5d'];
  const { data, error } = await supabase
    .from('agents')
    .select('id,name,dialogue_flow,general_capabilities')
    .in('id', ids as string[]);
  if (error) {
    console.error('Supabase error:', error);
    process.exit(1);
  }
  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    has_flow: r.dialogue_flow != null,
    allowed_tools: r.general_capabilities?.allowed_tools ?? null,
  }));
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
