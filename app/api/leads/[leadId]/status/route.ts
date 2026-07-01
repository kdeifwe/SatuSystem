import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runScenariosForLead } from '@/lib/server/scenarios/engine';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { leadId: string } }
) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const body = await req.json();
  const status = String(body.status || '').trim();
  if (!status) {
    return NextResponse.json({ error: 'status обязателен' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error: updateError } = await admin
    .from('leads')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', params.leadId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  try {
    const runResult = await runScenariosForLead(params.leadId, 'status_enter');
    return NextResponse.json({ success: true, runResult });
  } catch (error) {
    return NextResponse.json({ success: true, error: String(error instanceof Error ? error.message : error) }, { status: 200 });
  }
}
