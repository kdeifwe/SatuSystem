import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runAgentTurnWithLead } from '@/lib/server/ai/orchestrator';
import { splitAgentMessage, calculateTypingDelay } from '@/lib/server/ai/message-splitter';

// Webhook processing must use a service-role Supabase client because the request
// is unauthenticated and webhook events need cross-org access for leads/conversations/messages.
function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: { agentId: string } }
) {
  const rawBody = await req.text();
  let body: any = {};

  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch (err) {
    console.error('[TG webhook] Invalid JSON body:', err, 'rawBody:', rawBody.slice(0, 500));
    return NextResponse.json({ ok: true });
  }

  // Запускаем обработку асинхронно
  handleUpdate(body, params.agentId).catch(err =>
    console.error('[TG webhook] Unhandled error:', err)
  );

  return NextResponse.json({ ok: true });
}

async function handleUpdate(update: any, agentId: string) {
  console.log('[TG webhook] Received update for agent:', agentId, JSON.stringify(update).slice(0, 200));
  
  const message = update.message;
  if (!message) {
    console.log('[TG webhook] No message in update, skipping');
    return;
  }
  
  const text = message.text;
  if (!text) {
    console.log('[TG webhook] No text in message, skipping');
    return;
  }

  const chatId = String(message.chat.id);
  const userName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || 'Клиент';
  const externalMessageId = `tg_${message.message_id}`;

  const admin = getAdmin();

  try {
    // 1. Получаем агента
    const { data: agent, error: agentErr } = await admin
      .from('agents')
      .select('id, name, org_id, system_prompt_compiled, general_capabilities')
      .eq('id', agentId)
      .single();

    if (agentErr || !agent) {
      console.error('[TG webhook] Agent not found:', agentId, agentErr);
      return;
    }

    console.log('[TG webhook] Agent found:', agent.name, 'org:', agent.org_id);

    // 2. Получаем channel с токеном — строго в рамках org_id этого агента.
    // Без фильтра по org_id при нескольких активных telegram-каналах уйдём
    // в чужую организацию, а maybeSingle() бросит ошибку при >1 совпадении.
    const { data: channel, error: chErr } = await admin
      .from('channels')
      .select('id, credentials')
      .eq('type', 'telegram')
      .eq('org_id', agent.org_id)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (chErr || !channel) {
      console.error('[TG webhook] Channel not found:', chErr);
      return;
    }

    const botToken = channel.credentials?.token;
    if (!botToken) {
      console.error('[TG webhook] No bot token in channel credentials');
      return;
    }

    // 3. Идемпотентность — проверяем дубликаты
    const { data: existingMsg } = await admin
      .from('messages')
      .select('id')
      .eq('external_message_id', externalMessageId)
      .maybeSingle();

    if (existingMsg) {
      console.log('[TG webhook] Duplicate message, skipping:', externalMessageId);
      return;
    }

    // 4. Получаем или создаём лида
    let { data: lead } = await admin
      .from('leads')
      .select('id, ai_enabled, name')
      .eq('channel_id', channel.id)
      .eq('external_id', chatId)
      .maybeSingle();

    if (!lead) {
      console.log('[TG webhook] Creating new lead for chat:', chatId);
      const { data: newLead, error: leadErr } = await admin
        .from('leads')
        .insert({
          org_id: agent.org_id,
          channel_id: channel.id,
          external_id: chatId,
          name: userName,
          status: 'new',
          ai_enabled: true,
        })
        .select('id, ai_enabled, name')
        .single();

      if (leadErr || !newLead) {
        console.error('[TG webhook] Failed to create lead:', leadErr);
        return;
      }
      lead = newLead;
    }

      // Detect lead_returned: if we have a recorded last_inbound_at and it was long ago
      try {
        const { data: rts } = await admin.from('lead_repeat_touch_state').select('last_inbound_at').eq('lead_id', lead.id).maybeSingle();
        const lastInbound = rts?.last_inbound_at ? new Date(rts.last_inbound_at) : null;
        if (lastInbound) {
          const ms = Date.now() - lastInbound.getTime();
          const days = ms / (1000 * 60 * 60 * 24);
          if (days >= 1) {
            await admin.from('notification_log').insert({
              org_id: agent.org_id,
              agent_id: agentId,
              lead_id: lead.id,
              event_type: 'lead_returned',
              payload: { lead_name: lead.name, days_silent: Math.floor(days), message_preview: String(text).slice(0, 200) },
              delivery_status: 'pending',
            });
          }
        }
      } catch (e) {
        console.error('[TG webhook] failed to check lead_returned', e);
      }

    console.log('[TG webhook] Lead:', lead.id, 'ai_enabled:', lead.ai_enabled);

    // 5. Получаем или создаём conversation
    let { data: conversation } = await admin
      .from('conversations')
      .select('id')
      .eq('lead_id', lead.id)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conversation) {
      const { data: newConv, error: convErr } = await admin
        .from('conversations')
        .insert({ lead_id: lead.id, agent_id: agentId })
        .select('id')
        .single();

      if (convErr || !newConv) {
        console.error('[TG webhook] Failed to create conversation:', convErr);
        return;
      }
      conversation = newConv;
    }

    // 6. Сохраняем входящее сообщение
    const { data: insertedUserMessage } = await admin.from('messages').insert({
      conversation_id: conversation.id,
      sender: 'user',
      content: text,
      external_message_id: externalMessageId,
    }).select('id').single();
    const currentUserMessageId = insertedUserMessage?.id ?? null;

    // 7. Если AI выключен для этого лида — не отвечаем
    if (!lead.ai_enabled) {
      console.log('[TG webhook] AI disabled for lead, skipping');
      return;
    }

    // 8. Получаем историю
    const { data: history } = await admin
      .from('messages')
      .select('sender, content')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(20);

    const historyFormatted = (history ?? [])
      .reverse()
      .slice(0, -1)
      .map(m => ({
        role: (m.sender === 'user' ? 'user' : 'model') as 'user' | 'model',
        text: m.content ?? '',
      }))
      .filter(m => m.text.length > 0);

    console.log('[TG webhook] Running AI for message:', text.slice(0, 50));

    // 9. Запускаем AI
    const systemPrompt = agent.system_prompt_compiled ?? 
      `Ты ${agent.name}. Отвечай кратко и по-человечески.`;

    const { answer } = await runAgentTurnWithLead(agentId, systemPrompt, text, [], lead.id, currentUserMessageId);

    console.log('[TG webhook] AI answer:', answer.slice(0, 100));

    // 10. Разделяем на части если включено
    const caps = agent.general_capabilities ?? {};
    const splitEnabled = caps.split_messages ?? true;
    const maxParts = caps.split_max_parts ?? 2;
    const typingSimulation = caps.typing_simulation ?? true;

    const parts = splitAgentMessage(answer, splitEnabled).slice(0, maxParts);

    // 11. Отправляем каждую часть с задержкой
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      
      if (i > 0 && typingSimulation) {
        // Имитируем "печатает..."
        await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
        });
        
        const delay = calculateTypingDelay(part.text);
        await new Promise(r => setTimeout(r, Math.min(delay, 3000)));
      }

      // Отправляем сообщение
      const sendRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          chat_id: chatId, 
          text: part.text,
          parse_mode: 'HTML',
        }),
      });

      const sendData = await sendRes.json();
        console.log('[TG webhook] Message sent:', sendData.ok, sendData.error_code);
        if (!sendRes.ok || !sendData?.ok) {
          try {
            const channelId = channel?.id ?? null;
            // temporary debug logging removed
            const { data: existing } = await admin.from('channel_error_counters').select('consecutive_errors').eq('channel_id', channelId).maybeSingle();
            const prev = existing?.consecutive_errors ?? 0;
            const next = prev + 1;
            await admin.from('channel_error_counters').upsert({ channel_id: channelId, consecutive_errors: next, last_error_at: new Date(), last_error_message: JSON.stringify(sendData), updated_at: new Date().toISOString() });
            if (next >= 3) {
              await admin.from('notification_log').insert({
                org_id: agent.org_id,
                agent_id: agentId,
                lead_id: null,
                event_type: 'channel_down',
                payload: { channel_type: 'telegram', channel_name: 'Telegram Bot', error_message: JSON.stringify(sendData), time: new Date() },
                delivery_status: 'pending',
              });
              await admin.from('channel_error_counters').update({ consecutive_errors: 0, updated_at: new Date().toISOString() }).eq('channel_id', channelId);
            }
          } catch (e) {
            console.error('[TG webhook] failed to update channel_error_counters', e);
          }
        } else {
          try {
            const channelId = channel?.id ?? null;
            await admin.from('channel_error_counters').update({ consecutive_errors: 0, updated_at: new Date().toISOString() }).eq('channel_id', channelId);
          } catch (e) {
            // ignore
          }
        }

      // Сохраняем ответ AI
      await admin.from('messages').insert({
        conversation_id: conversation.id,
        sender: 'ai',
        content: part.text,
        external_message_id: `tg_ai_${message.message_id}_${i}`,
      });
    }

    console.log('[TG webhook] Done!');

  } catch (err) {
    console.error('[TG webhook] Error:', err);
  }
}
