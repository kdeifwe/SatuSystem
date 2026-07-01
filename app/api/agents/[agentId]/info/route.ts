import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  req: NextRequest,
  { params }: { params: { agentId: string } }
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
  }

  const { data } = await supabase
    .from('agents')
    .select('id, name, role, goal, system_prompt_compiled')
    .eq('id', params.agentId)
    .single();

  return NextResponse.json(data ?? {});
}
