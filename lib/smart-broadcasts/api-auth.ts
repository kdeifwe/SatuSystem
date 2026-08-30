import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export async function getSmartBroadcastOrg() {
  const userClient = createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) throw new Error('UNAUTHORIZED');
  const supabase = createServiceClient();
  const { data: membership } = await supabase.from('org_members').select('org_id').eq('user_id', user.id).limit(1).maybeSingle();
  if (!membership?.org_id) throw new Error('FORBIDDEN');
  return { user, orgId: membership.org_id as string };
}
