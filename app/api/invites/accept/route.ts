import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase-server';

// This flow performs privileged writes to auth, profiles, org_members and invites,
// so it must use the service-role client rather than the regular user client.

const MIN_PASSWORD_LENGTH = 6;

export async function POST(request: Request) {
  const body = await request.json();
  const token = String(body.token ?? '').trim();
  const password = String(body.password ?? '');

  if (!token || !password) {
    return NextResponse.json(
      { error: 'Токен и пароль обязательны для регистрации.' },
      { status: 400 }
    );
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      {
        error: `Пароль должен быть длиной не менее ${MIN_PASSWORD_LENGTH} символов.`,
      },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdminClient();
  const { data: invite, error: inviteError } = await admin
    .from('invites')
    .select('id, org_id, email, role, status')
    .eq('token', token)
    .single();

  if (inviteError || !invite || invite.status !== 'pending') {
    return NextResponse.json({ error: 'Неверный или просроченный токен приглашения.' }, { status: 400 });
  }

  const { data: existingUsersData, error: listUsersError } = await admin.auth.admin.listUsers();
  if (listUsersError) {
    return NextResponse.json({ error: listUsersError.message }, { status: 500 });
  }

  const existingUser = existingUsersData?.users?.find((user) => user.email === invite.email);
  if (existingUser?.id) {
    return NextResponse.json(
      {
        error: `Email ${invite.email} уже зарегистрирован. Войдите в систему и попросите владельца организации добавить вас вручную.`,
      },
      { status: 409 }
    );
  }

  const { data: userData, error: createUserError } = await admin.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true,
  });

  if (createUserError || !userData.user?.id) {
    return NextResponse.json({ error: createUserError?.message ?? 'Не удалось создать пользователя.' }, { status: 500 });
  }

  const userId = userData.user.id;
  const { error: profileError } = await admin.from('profiles').upsert({
    id: userId,
    email: invite.email,
    full_name: null,
  });

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const { error: memberError } = await admin.from('org_members').insert({
    org_id: invite.org_id,
    user_id: userId,
    role: invite.role,
  });

  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  const { error: updateError } = await admin
    .from('invites')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', invite.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
