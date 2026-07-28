import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseServer } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { requireOwnerOrAdmin } from '@/lib/server/permissions';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { agentId: string } }
) {
  const supabase = createSupabaseServer();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
  }

  try {
    const admin = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const membership = await requireOwnerOrAdmin(admin, user.id);

    const { data: agent, error: agentError } = await admin
      .from('agents')
      .select('id, org_id')
      .eq('id', params.agentId)
      .maybeSingle();

    if (agentError) {
      return NextResponse.json({ error: agentError.message }, { status: 500 });
    }

    if (!agent) {
      return NextResponse.json({ error: 'Агент не найден' }, { status: 404 });
    }

    if (agent.org_id !== membership.org_id) {
      return NextResponse.json({ error: 'Нет прав на удаление этого агента' }, { status: 403 });
    }

    const { error: deleteError } = await admin
      .from('agents')
      .delete()
      .eq('id', params.agentId)
      .eq('org_id', membership.org_id);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось удалить агента';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
