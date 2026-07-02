import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runAgentTurn } from '@/lib/server/ai/orchestrator';
import { splitAgentMessage, calculateTypingDelay } from '@/lib/server/ai/message-splitter';
import { sendWhatsAppMessage } from '@/lib/channels/whatsapp';

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function verifyWhatsAppWebhook(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const admin = getAdmin();
  const { data: channel } = await admin
    .from('channels')
    .select('credentials')
    .eq('type', 'whatsapp')
    .eq('is_active', true)
    .maybeSingle();

  const verifyToken = (channel?.credentials as Record<string, unknown> | null)?.webhook_verify_token;

  if (mode === 'subscribe' && token === verifyToken) {
    return new Response(challenge ?? 'OK', { status: 200 });
  }

  return new Response('Forbidden', { status: 403 });
}

export async function handleWhatsAppWebhook(req: NextRequest) {
  const rawBody = await req.text();
  const channel = await getActiveWhatsAppChannel();
  const rawAppSecret = (channel?.credentials as Record<string, unknown> | null)?.app_secret;
  const appSecret: string | undefined =
    typeof rawAppSecret === 'string' ? rawAppSecret : (process.env.WHATSAPP_APP_SECRET ?? undefined);

  const isValid = await verifyMetaSignature(req, rawBody, appSecret);
  if (!isValid) {
    console.error('[whatsapp webhook] invalid signature or missing app secret');
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const body = JSON.parse(rawBody);
    setImmediate(() => {
      void processIncomingWhatsAppMessage(body);
    });
  } catch (error) {
    console.error('[whatsapp webhook] invalid JSON body', error);
    return new Response('Bad Request', { status: 400 });
  }

  return new Response('OK', { status: 200 });
}

async function getActiveWhatsAppChannel() {
  const admin = getAdmin();
  const { data: channel, error } = await admin
    .from('channels')
    .select('id, org_id, credentials')
    .eq('type', 'whatsapp')
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    console.error('[whatsapp webhook] failed to load active WhatsApp channel', error);
    return null;
  }

  return channel;
}

async function verifyMetaSignature(req: NextRequest, rawBody: string, appSecret?: string | null) {
  if (process.env.SKIP_WEBHOOK_SIGNATURE_CHECK === 'true') {
    console.warn('[whatsapp webhook] ⚠️ Signature check SKIPPED (dev mode)');
    return true;
  }

  const signature = req.headers.get('x-hub-signature-256');
  if (!signature) {
    console.error('[whatsapp webhook] Missing x-hub-signature-256 header');
    return false;
  }

  if (!appSecret) {
    console.error('[whatsapp webhook] WHATSAPP_APP_SECRET not configured');
    return false;
  }

  const expectedSignature = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;

  try {
    const signatureBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }
    return timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch (error) {
    console.error('[whatsapp webhook] signature verification failed', error);
    return false;
  }
}

async function processIncomingWhatsAppMessage(body: any) {
  try {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.messages?.[0]) {
      return;
    }

    const msg = value.messages[0];
    const phoneNumber = msg.from;
    const text = msg.text?.body ?? '';
    const messageId = msg.id;

    if (!phoneNumber || !text) {
      return;
    }

    const admin = getAdmin();
    const externalMessageId = `wa_${messageId}`;

    const { data: existingMsg } = await admin
      .from('messages')
      .select('id')
      .eq('external_message_id', externalMessageId)
      .maybeSingle();

    if (existingMsg) {
      return;
    }

    const { data: channel } = await admin
      .from('channels')
      .select('id, org_id, credentials')
      .eq('type', 'whatsapp')
      .eq('is_active', true)
      .maybeSingle();

    if (!channel) {
      console.error('[whatsapp webhook] channel not found');
      return;
    }

    const { data: agent } = await admin
      .from('agents')
      .select('id, name, org_id, system_prompt_compiled, general_capabilities')
      .eq('org_id', channel.org_id)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!agent) {
      console.error('[whatsapp webhook] agent not found');
      return;
    }

    let { data: lead } = await admin
      .from('leads')
      .select('id, ai_enabled')
      .eq('channel_id', channel.id)
      .eq('external_id', phoneNumber)
      .maybeSingle();

    if (!lead) {
      const { data: newLead } = await admin
        .from('leads')
        .insert({
          org_id: channel.org_id,
          channel_id: channel.id,
          external_id: phoneNumber,
          name: phoneNumber,
          status: 'new',
          ai_enabled: true,
        })
        .select('id, ai_enabled')
        .single();
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
            org_id: channel.org_id,
            agent_id: agent.id,
            lead_id: lead.id,
            event_type: 'lead_returned',
            payload: { lead_name: lead.name, days_silent: Math.floor(days), message_preview: String(text).slice(0, 200) },
            delivery_status: 'pending',
          });
        }
      }
    } catch (e) {
      console.error('[whatsapp webhook] failed to check lead_returned', e);
    }

    if (!lead) {
      return;
    }

    let { data: conversation } = await admin
      .from('conversations')
      .select('id')
      .eq('lead_id', lead.id)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conversation) {
      const { data: newConversation } = await admin
        .from('conversations')
        .insert({ lead_id: lead.id, agent_id: agent.id })
        .select('id')
        .single();
      conversation = newConversation;
    }

    if (!conversation) {
      return;
    }

    await admin.from('messages').insert({
      conversation_id: conversation.id,
      sender: 'user',
      content: text,
      external_message_id: externalMessageId,
    });

    if (!lead.ai_enabled) {
      return;
    }

    const { data: history } = await admin
      .from('messages')
      .select('sender, content')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(20);

    const historyFormatted = (history ?? [])
      .reverse()
      .slice(0, -1)
      .map((message) => ({
        role: (message.sender === 'user' ? 'user' : 'model') as 'user' | 'model',
        text: message.content ?? '',
      }))
      .filter((message) => message.text.length > 0);

    const systemPrompt = agent.system_prompt_compiled ?? `Ты ${agent.name}`;
    const { answer } = await runAgentTurn(agent.id, systemPrompt, text, historyFormatted);

    const capabilities = agent.general_capabilities ?? {};
    const parts = splitAgentMessage(answer, capabilities.split_messages ?? true).slice(0, capabilities.split_max_parts ?? 2);
    const credentials = (channel.credentials as Record<string, unknown> | null) ?? {};
    const phoneNumberId = String(credentials.phone_number_id ?? '');
    const accessToken = String(credentials.access_token ?? '');
    const recipient = phoneNumber.replace(/^\+/, '');

    for (let i = 0; i < parts.length; i += 1) {
      if (i > 0 && capabilities.typing_simulation !== false) {
        await new Promise((resolve) => setTimeout(resolve, calculateTypingDelay(parts[i].text)));
      }

      if (phoneNumberId && accessToken) {
        await sendWhatsAppMessage(phoneNumberId, accessToken, recipient, parts[i].text).catch((error) => {
          console.error('[whatsapp webhook] send error', error);
        });
      }

      await admin.from('messages').insert({
        conversation_id: conversation.id,
        sender: 'ai',
        content: parts[i].text,
        external_message_id: `wa_ai_${messageId}_${i}`,
      });
    }
  } catch (error) {
    console.error('[whatsapp webhook]', error);
  }
}
