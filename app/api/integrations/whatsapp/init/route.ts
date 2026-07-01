import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const { agentId } = await req.json();

  return NextResponse.json({
    setup_needed: true,
    instructions: `Используйте форму настройки WhatsApp в /dashboard/${agentId}/integrations`,
  });
}
