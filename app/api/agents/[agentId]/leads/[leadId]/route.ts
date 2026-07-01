import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function PATCH(req: NextRequest, { params }: { params: { agentId: string; leadId: string } }) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const body = await req.json();
  const aiEnabled = typeof body.ai_enabled === 'boolean' ? body.ai_enabled : null;

  if (aiEnabled === null) {
    return NextResponse.json({ error: 'ai_enabled обязателен' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('leads')
    .update({ ai_enabled: aiEnabled })
    .eq('id', params.leadId)
    .eq('org_id', (await admin.from('agents').select('org_id').eq('id', params.agentId).single()).data?.org_id ?? '')
    .select('id, ai_enabled')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
