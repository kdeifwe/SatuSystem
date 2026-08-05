import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

function errorResponse(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { agentId: string } }
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return errorResponse('Не авторизован', 401);
  }

  const agentId = params.agentId;
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
  const { data: lead, error: leadError } = await admin
    .from('leads')
    .select('id')
    .eq('org_id', agentData.org_id)
    .eq('external_id', externalId)
    .maybeSingle();

  if (leadError) {
    return errorResponse('Не удалось найти sandbox lead');
  }

  if (!lead?.id) {
    return NextResponse.json({ messages: [] });
  }

  const { data: conversation, error: convError } = await admin
    .from('conversations')
    .select('id')
    .eq('lead_id', lead.id)
    .eq('agent_id', agentId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (convError) {
    return errorResponse('Не удалось найти sandbox conversation');
  }

  if (!conversation?.id) {
    return NextResponse.json({ messages: [] });
  }

  const { data: messages, error: messagesError } = await admin
    .from('messages')
    .select('id, sender, content, created_at')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: true });

  if (messagesError) {
    return errorResponse('Не удалось загрузить сообщения sandbox');
  }

  return NextResponse.json({ messages: messages ?? [] });
}
