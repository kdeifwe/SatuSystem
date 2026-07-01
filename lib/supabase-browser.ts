'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;

function decodeJwtPayload(token: string) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadBase64.padEnd(Math.ceil(payloadBase64.length / 4) * 4, '=');
    const decoded = typeof window !== 'undefined' && typeof window.atob === 'function'
      ? window.atob(padded)
      : Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(decoded) as Record<string, any>;
  } catch {
    return null;
  }
}

function isServiceRoleKey(key: string) {
  if (key.includes('service_role')) return true;
  const payload = decodeJwtPayload(key);
  return payload?.role === 'service_role';
}

function getSupabaseUrl() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set in .env.local at the project root'
    );
  }

  if (isServiceRoleKey(supabaseAnonKey)) {
    throw new Error(
      'Forbidden use of secret API key in browser. Set NEXT_PUBLIC_SUPABASE_ANON_KEY to the public anon key and keep the service role key only on the server.'
    );
  }

  return { supabaseUrl, supabaseAnonKey };
}

export function getSupabaseClient() {
  if (!supabaseClient) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseUrl();
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
  }

  return supabaseClient;
}

export const supabase = getSupabaseClient();
