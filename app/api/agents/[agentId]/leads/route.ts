import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: NextRequest, { params }: { params: { agentId: string } }) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: agent } = await admin.from('agents').select('org_id').eq('id', params.agentId).single();
  if (!agent) return NextResponse.json({ leads: [] });

  // Получаем лидов с последним сообщением
  const { data: conversations } = await admin
    .from('conversations')
    .select(`
      id,
      lead_id,
      leads!inner(id, name, external_id, status, created_at, updated_at, org_id, ai_enabled),
      messages(content, sender, created_at)
    `)
    .eq('agent_id', params.agentId)
    .eq('leads.org_id', agent.org_id)
    .order('started_at', { ascending: false });

  const leadsMap = new Map<string, any>();
  for (const conv of conversations ?? []) {
    const lead = (conv as any).leads;
    if (!lead || leadsMap.has(lead.id)) continue;

    const msgs = ((conv as any).messages ?? []).sort((a: any, b: any) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    leadsMap.set(lead.id, {
      ...lead,
      conversation_id: conv.id,
      last_message: msgs[0]?.content?.slice(0, 60) ?? null,
    });
  }

  return NextResponse.json({ leads: Array.from(leadsMap.values()) });
}
