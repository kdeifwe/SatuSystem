import { NextResponse } from 'next/server';

// Regular self-registration is intentionally disabled; invite-based onboarding is the only path.
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

  return NextResponse.json(
    {
      error:
        'Регистрация закрыта. Вход доступен только через приглашение. Используйте API /api/invites/accept.',
    },
    { status: 403 }
  );
}
