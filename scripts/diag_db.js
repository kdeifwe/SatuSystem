const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

Promise.all([
  s.from('leads').select('*').order('created_at',{ascending:false}).limit(5),
  s.from('conversations').select('*').order('started_at',{ascending:false}).limit(5),
  s.from('messages').select('*').order('created_at',{ascending:false}).limit(10),
  s.from('channels').select('id,type,credentials,is_active'),
]).then(([l,c,m,ch]) => {
  console.log('LEADS:', JSON.stringify(l.data,null,2));
  console.log('CONVS:', JSON.stringify(c.data,null,2));
  console.log('MSGS:', JSON.stringify(m.data,null,2));
  const channels = (ch.data||[]).map(x=>({
    ...x,
    credentials: {
      ...x.credentials,
      token: x.credentials?.token ? x.credentials.token.slice(0,10)+'...' : null,
      session_string: x.credentials?.session_string ? '[EXISTS]' : null
    }
  }));
  console.log('CHANNELS:', JSON.stringify(channels,null,2));
  process.exit(0);
}).catch(e=>{
  console.error(e);
  process.exit(1);
});
