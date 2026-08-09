import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function validateSupabaseEnv(): { supabaseUrl: string; supabaseServiceRoleKey: string } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local at the project root.'
    );
  }

  return { supabaseUrl, supabaseServiceRoleKey };
}

export function createAdminClient(): SupabaseClient {
  const { supabaseUrl, supabaseServiceRoleKey } = validateSupabaseEnv();

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
