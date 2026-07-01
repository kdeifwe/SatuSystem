import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(
  req: NextRequest,
  { params }: { params: { agentId: string; leadId: string } }
) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: conversation } = await admin
    .from('conversations')
    .select('id')
    .eq('lead_id', params.leadId)
    .eq('agent_id', params.agentId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conversation) return NextResponse.json({ messages: [] });

  const { data: messages } = await admin
    .from('messages')
    .select('id, sender, content, created_at')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: true });

  return NextResponse.json({ messages: messages ?? [] });
}
