import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '../../../lib/supabase-server';

const MIN_PASSWORD_LENGTH = 6;

export async function POST(request: Request) {
  const body = await request.json();
  const email = String(body.email ?? '').trim();
  const password = String(body.password ?? '');

  if (!email || !password) {
    return NextResponse.json(
      { error: 'Email и пароль обязательны для регистрации.' },
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

  const supabaseAdmin = getSupabaseAdminClient();
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const user = data.user;
  if (user?.id) {
    const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
      id: user.id,
      email: user.email,
      full_name: null,
    });

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
