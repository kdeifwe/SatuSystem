import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

function digitsOnly(value: unknown): string | null {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

function resolveLeadPhone(lead: any): string | null {
  const attrs = (lead.attributes ?? {}) as Record<string, unknown>;

  const savedWhatsappPhone = digitsOnly(attrs.whatsapp_phone);
  if (savedWhatsappPhone) return savedWhatsappPhone;

  const externalId = String(lead.external_id ?? '');
  const [rawUser, server] = externalId.split('@');
  const user = String(rawUser ?? '').split(':')[0];

  if (server === 's.whatsapp.net') return digitsOnly(user);

  return digitsOnly(attrs.phone);
}

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

  console.time('db:load-conversations');
  const { data: conversations } = await admin
    .from('conversations')
    .select(`
      id,
      lead_id,
      leads!inner(id, name, external_id, status, created_at, updated_at, org_id, ai_enabled, attributes),
      messages(content, sender, created_at)
    `)
    .eq('agent_id', params.agentId)
    .eq('leads.org_id', agent.org_id)
    .eq('is_sandbox', false)
    .order('started_at', { ascending: false });
  console.timeEnd('db:load-conversations');

  console.time('build:lead-list');
  const leadsMap = new Map<string, any>();
  for (const conv of conversations ?? []) {
    const lead = (conv as any).leads;
    if (!lead || leadsMap.has(lead.id)) continue;

    const msgs = ((conv as any).messages ?? []).sort((a: any, b: any) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    const { attributes: _attributes, ...leadPublic } = lead;
    leadsMap.set(lead.id, {
      ...leadPublic,
      phone: resolveLeadPhone(lead),
      conversation_id: conv.id,
      last_message: msgs[0]?.content?.slice(0, 60) ?? null,
      last_message_at: msgs[0]?.created_at ?? lead.updated_at ?? lead.created_at,
    });
  }
  console.timeEnd('build:lead-list');

  // Свежие переписки сверху: сортируем по времени последнего сообщения, а не по дате начала диалога.
  const leads = Array.from(leadsMap.values()).sort(
    (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime(),
  );

  return NextResponse.json({ leads });
}
