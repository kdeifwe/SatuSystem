import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const { agentId } = await req.json();

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: membership } = await admin
    .from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership?.org_id) {
    return NextResponse.json({ error: 'Организация не найдена' }, { status: 404 });
  }

  const { data: existing } = await admin
    .from('channels')
    .select('id')
    .eq('org_id', membership.org_id)
    .eq('type', 'telegram')
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ success: true });
  }

  await admin.from('channels').update({ is_active: false }).eq('id', existing.id);
  return NextResponse.json({ success: true, agentId });
}
