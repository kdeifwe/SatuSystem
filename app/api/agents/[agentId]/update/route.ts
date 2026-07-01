import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function PATCH(req: NextRequest, { params }: { params: { agentId: string } }) {
  const { agentId } = params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
  }

  const body = await req.json();
  const { name, goal, role, tone_of_voice, human_communication_style } = body;

  if (!name || !goal || !role || !tone_of_voice) {
    return NextResponse.json({ error: 'name, goal, role и tone_of_voice обязательны' }, { status: 400 });
  }

  try {
    const { data: membership, error: membershipError } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', user.id)
      .single();

    if (membershipError || !membership) {
      return NextResponse.json({ error: 'Организация не найдена' }, { status: 400 });
    }

    const { error } = await supabase
      .from('agents')
      .update({
        name,
        goal,
        role,
        tone_of_voice,
        human_communication_style,
      })
      .eq('id', agentId)
      .eq('org_id', membership.org_id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
