import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const VALID_ROLES = ['owner', 'admin', 'member'] as const;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const email = String(body.email ?? '').trim().toLowerCase();
  const role = String(body.role ?? 'member');

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Укажите корректный email.' }, { status: 400 });
  }

  if (!VALID_ROLES.includes(role as typeof VALID_ROLES[number])) {
    return NextResponse.json({ error: 'Укажите корректную роль приглашения.' }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
    error: sessionError,
  } = await supabase.auth.getUser();

  if (sessionError || !user) {
    return NextResponse.json({ error: 'Требуется вход в систему.' }, { status: 401 });
  }

  const { data: currentMember, error: memberError } = await supabase
    .from('org_members')
    .select('org_id, role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (memberError || !currentMember) {
    return NextResponse.json({ error: 'Вы не являетесь членом организации.' }, { status: 403 });
  }

  if (!['owner', 'admin'].includes(currentMember.role)) {
    return NextResponse.json({ error: 'Нет прав для отправки приглашения.' }, { status: 403 });
  }

  const token = randomUUID();

  const { data, error: inviteError } = await supabase
    .from('invites')
    .insert([
      {
        org_id: currentMember.org_id,
        email,
        role,
        token,
        created_by: user.id,
        sent_at: new Date().toISOString(),
      },
    ])
    .select('token')
    .single();

  if (inviteError || !data) {
    return NextResponse.json({ error: inviteError?.message ?? 'Не удалось создать приглашение.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, token: data.token });
}
