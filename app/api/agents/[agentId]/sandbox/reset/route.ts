import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildSandboxConversationInsertData, buildSandboxLeadAttributes } from '@/lib/ai/sandbox-context';

function errorResponse(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: NextRequest, { params }: { params: { agentId: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return errorResponse('Не авторизован', 401);
  }

  const agentId = params?.agentId;
  if (!agentId) {
    return errorResponse('agentId обязателен', 400);
  }

  const { data: membership, error: membershipError } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .single();

  if (membershipError || !membership?.org_id) {
    return errorResponse('Доступ запрещён', 403);
  }

  const admin = createAdminClient();
  const { data: agentData, error: agentError } = await admin
    .from('agents')
    .select('org_id')
    .eq('id', agentId)
    .single();

  if (agentError || !agentData?.org_id) {
    return errorResponse('Агент не найден', 404);
  }

  if (membership.org_id !== agentData.org_id) {
    return errorResponse('Доступ запрещён', 403);
  }

  const externalId = `sandbox:${agentId}`;

  let { data: lead, error: leadError } = await admin
    .from('leads')
    .select('id, attributes, external_id')
    .eq('org_id', agentData.org_id)
    .eq('external_id', externalId)
    .maybeSingle();

  if (leadError) {
    return errorResponse('Не удалось найти sandbox lead');
  }

  if (!lead?.id) {
    const { data: fallbackLead, error: fallbackError } = await admin
      .from('leads')
      .select('id, attributes, external_id')
      .like('external_id', `sandbox:${agentId}%`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fallbackError) {
      return errorResponse('Не удалось найти sandbox lead');
    }

    if (fallbackLead?.id) {
      const { error: renameError } = await admin
        .from('leads')
        .update({ external_id: externalId })
        .eq('id', fallbackLead.id);

      if (renameError) {
        return errorResponse('Не удалось нормализовать sandbox lead');
      }

      lead = { ...fallbackLead, external_id: externalId };
    }
  }

  if (!lead?.id) {
    const { data: createdLead, error: createLeadError } = await admin
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

    if (createLeadError || !createdLead?.id) {
      return errorResponse('Не удалось создать новый sandbox-контекст');
    }

    lead = {
      id: createdLead.id,
      external_id: externalId,
      attributes: buildSandboxLeadAttributes(),
    } as const;
  }

  const { data: createdConversation, error: conversationError } = await admin
    .from('conversations')
    .insert(
      buildSandboxConversationInsertData({
        lead_id: lead.id,
        agent_id: agentId,
      })
    )
    .select('id')
    .single();

  if (conversationError || !createdConversation?.id) {
    return errorResponse('Не удалось создать новый sandbox conversation');
  }

  return NextResponse.json({
    leadId: lead.id,
    conversationId: createdConversation.id,
    externalId,
  });
}
