import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

// Dev/testing-only helper for smoke tests. It is intentionally narrow and should not be
// treated as a permanent public API auth mechanism for external clients.
function extractBearerToken(request?: NextRequest | Request) {
  const headerValue = request?.headers.get('authorization');
  if (!headerValue?.startsWith('Bearer ')) {
    return null;
  }

  return headerValue.slice('Bearer '.length).trim();
}

export function createClientWithAuthorization(request?: NextRequest | Request) {
  const bearerToken = extractBearerToken(request);
  if (!bearerToken) {
    throw new Error('Authorization header with Bearer token is required for this client');
  }

  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${bearerToken}` } },
  });
}
