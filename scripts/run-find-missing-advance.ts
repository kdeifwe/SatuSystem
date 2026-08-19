import { createAdminClient } from '../lib/supabase/admin.ts';

async function main() {
  const admin = createAdminClient();
  const { data, error } = await admin.from('agents').select('id, name, general_capabilities, dialogue_flow');
  if (error) {
    console.error('Query error', error);
    process.exit(2);
  }

  const rows = (data ?? []).filter((r: any) => r.dialogue_flow !== null);
  const filtered = rows.filter((r: any) => {
    const allowed = r.general_capabilities?.allowed_tools;
    if (!Array.isArray(allowed)) return true;
    return !allowed.includes('advanceFunnelStep');
  }).map((r: any) => ({ id: r.id, name: r.name, allowed_tools: r.general_capabilities?.allowed_tools ?? null, has_dialogue_flow: r.dialogue_flow != null }));

  console.log(JSON.stringify(filtered, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
