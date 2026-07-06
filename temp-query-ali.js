const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing env vars');
  process.exit(1);
}
const supabase = createClient(url, key);
(async () => {
  const { data, error } = await supabase.from('agents').select('id,name,org_id,role,goal,tone_of_voice,communication_rules,dialogue_flow,system_prompt_compiled').ilike('name','%али%').limit(10);
  if (error) {
    console.error(JSON.stringify(error, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(data, null, 2));
})();
