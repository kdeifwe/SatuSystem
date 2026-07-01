import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let supabaseAdminClient: SupabaseClient | null = null;

function getSupabaseServerConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local at the project root.'
    );
  }

  return { supabaseUrl, supabaseServiceRoleKey };
}

export function getSupabaseAdminClient() {
  if (!supabaseAdminClient) {
    const { supabaseUrl, supabaseServiceRoleKey } = getSupabaseServerConfig();
    supabaseAdminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });
  }

  return supabaseAdminClient;
}
