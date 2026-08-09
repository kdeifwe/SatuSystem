import { createServerClient } from '@supabase/ssr';
import { cookies, headers } from 'next/headers';
import type { NextRequest } from 'next/server';

export function createClient(request?: Pick<NextRequest, 'cookies'>) {
  const cookieStore = request?.cookies ?? cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll().map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
          }));
        },
      },
    }
  );
}

export async function getServerUser(
  supabase: ReturnType<typeof createClient>,
  authorizationHeader?: string,
) {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    return user;
  }

  const authHeader = authorizationHeader
    ? authorizationHeader.replace(/^Bearer\s+/i, '').trim()
    : headers()
        .get('authorization')
        ?.replace(/^Bearer\s+/i, '')
        .trim();
  if (!authHeader) {
    return null;
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${authHeader}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    },
  });

  if (!response.ok) {
    return null;
  }

  const userData = await response.json();
  return userData.user ?? null;
}
