import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildSandboxLeadAttributes } from '@/lib/ai/sandbox-context';

export async function POST(req: NextRequest, { params }: { params: { agentId: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
  }

  const agentId = params?.agentId;
  if (!agentId) {
    return NextResponse.json({ error: 'agentId обязателен' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: agentData, error: agentError } = await admin
    .from('agents')
    .select('org_id')
    .eq('id', agentId)
    .single();

  if (agentError || !agentData?.org_id) {
    return NextResponse.json({ error: 'Агент не найден' }, { status: 404 });
  }

  const externalId = `sandbox:${agentId}:${Date.now()}`;
  const { data: existingSandboxLeads } = await admin
    .from('leads')
    .select('id')
    .eq('org_id', agentData.org_id)
    .like('external_id', `sandbox:${agentId}%`);

  const leadIds = (existingSandboxLeads ?? [])
    .map((lead) => lead.id)
    .filter((id): id is string => Boolean(id));

  if (leadIds.length > 0) {
    const { data: existingConversations } = await admin
      .from('conversations')
      .select('id')
      .in('lead_id', leadIds);

    const conversationIds = (existingConversations ?? [])
      .map((conversation) => conversation.id)
      .filter((id): id is string => Boolean(id));

    if (conversationIds.length > 0) {
      await admin.from('ai_call_logs').delete().in('conversation_id', conversationIds);
      await admin.from('messages').delete().in('conversation_id', conversationIds);
      await admin.from('conversations').delete().in('id', conversationIds);
    }

    await admin.from('lead_funnel_state').delete().in('lead_id', leadIds);
    await admin.from('leads').delete().in('id', leadIds);
  }

  const { data: createdLead, error: leadError } = await admin
    .from('leads')
    .insert({
      org_id: agentData.org_id,
      external_id: externalId,
      name: 'Sandbox lead',
      ai_enabled: true,
      attributes: buildSandboxLeadAttributes(),
    })
    .select('id')
    .single();

  if (leadError || !createdLead?.id) {
    return NextResponse.json({ error: 'Не удалось создать новый sandbox-контекст' }, { status: 500 });
  }

  const { data: createdConversation } = await admin
    .from('conversations')
    .insert({
      lead_id: createdLead.id,
      agent_id: agentId,
    })
    .select('id')
    .single();

  return NextResponse.json({
    leadId: createdLead.id,
    conversationId: createdConversation?.id ?? null,
    externalId,
  });
}
