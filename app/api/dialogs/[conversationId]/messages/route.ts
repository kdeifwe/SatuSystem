import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppText } from '@/lib/channels/baileys-client';
import { sendTelegramText } from '@/lib/channels/telegram-client';

function errorResponse(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest, { params }: { params: { conversationId: string } }) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('messages')
    .select('id, sender, content, tool_calls, created_at')
    .eq('conversation_id', params.conversationId)
    .order('created_at', { ascending: true });

  if (error) {
    return errorResponse(error.message);
  }

  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest, { params }: { params: { conversationId: string } }) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const content = String(body?.content ?? '').trim();

  if (!content) {
    return errorResponse('content обязателен', 400);
  }

  const admin = createAdminClient();

  const { data: conv, error: convErr } = await admin
    .from('conversations')
    .select(`
      agent_id,
      lead_id,
      leads (
        external_id,
        channel_id,
        channels ( type )
      )
    `)
    .eq('id', params.conversationId)
    .single();

  if (convErr || !conv) {
    return errorResponse('Диалог не найден', 404);
  }

  const channelType = (conv.leads as any)?.channels?.type;
  const externalId = (conv.leads as any)?.external_id;
  const channelId = (conv.leads as any)?.channel_id;
  const agentId = (conv as any)?.agent_id;

  if (!channelType || !externalId || !channelId || !agentId) {
    return errorResponse('Не удалось определить адресата для отправки', 400);
  }

  try {
    if (channelType === 'whatsapp') {
      await sendWhatsAppText(agentId, externalId, content);
    } else if (channelType === 'telegram') {
      await sendTelegramText(channelId, externalId, content);
    } else {
      return errorResponse(`Канал ${channelType} не поддерживает отправку`, 400);
    }
  } catch (sendError) {
    console.error('[dialogs] Отправка сообщения не удалась:', sendError);
    return errorResponse(`Не удалось отправить сообщение в ${channelType}. Канал может быть отключен.`, 502);
  }

  const { data: message, error: insertError } = await admin
    .from('messages')
    .insert({
      conversation_id: params.conversationId,
      sender: 'operator',
      content,
      operator_id: user.id,
    })
    .select('id, sender, content, created_at')
    .single();

  if (insertError) {
    console.error('[dialogs] Сообщение отправлено, но не сохранено в БД:', insertError);
  }

  return NextResponse.json({ message });
}
