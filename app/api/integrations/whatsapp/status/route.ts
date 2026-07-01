import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const agentId = req.nextUrl.searchParams.get('agentId');

  if (!agentId) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({ connected: false, instructions: 'Используйте форму настройки WhatsApp Cloud API в интеграциях' });
}
