import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runAgentTurnWithLead } from '@/lib/server/ai/orchestrator';
import { splitAgentMessage, calculateTypingDelay } from '@/lib/server/ai/message-splitter';
import { sendWhatsAppMessage } from '@/lib/channels/whatsapp';
import { withLeadProcessingLock } from '@/lib/server/lead-processing-queue';

// WhatsApp webhook callbacks run outside a user session, so we use a service-role
// Supabase client here to bypass RLS while still keeping the webhook handling secure.
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
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const verifyToken = (channel?.credentials as Record<string, unknown> | null)?.webhook_verify_token;

  if (mode === 'subscribe' && token === verifyToken) {
    return new Response(challenge ?? 'OK', { status: 200 });
  }

  return new Response('Forbidden', { status: 403 });
}

export async function handleWhatsAppWebhook(req: NextRequest) {
  const rawBody = await req.text();

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch (error) {
    console.error('[whatsapp webhook] invalid JSON body', error);
    return new Response('Bad Request', { status: 400 });
  }

  const phoneNumberId = body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  const channel = await resolveWhatsAppChannelByPhoneNumberId(phoneNumberId);

  const rawAppSecret = (channel?.credentials as Record<string, unknown> | null)?.app_secret;
  const appSecret: string | undefined =
    typeof rawAppSecret === 'string' ? rawAppSecret : (process.env.WHATSAPP_APP_SECRET ?? undefined);

  const isValid = await verifyMetaSignature(req, rawBody, appSecret);
  if (!isValid) {
    console.error('[whatsapp webhook] invalid signature or missing app secret');
    return new Response('Unauthorized', { status: 401 });
  }

  setImmediate(() => {
    void processIncomingWhatsAppMessage(body);
  });

  return new Response('OK', { status: 200 });
}

async function resolveWhatsAppChannelByPhoneNumberId(phoneNumberId: string | undefined | null) {
  if (!phoneNumberId) {
    console.error('[whatsapp webhook] phone_number_id missing in webhook payload, cannot resolve channel');
    return null;
  }

  const admin = getAdmin();
  const { data: channel, error } = await admin
    .from('channels')
    .select('id, org_id, credentials')
    .eq('type', 'whatsapp')
    .eq('is_active', true)
    .eq('credentials->>phone_number_id', phoneNumberId)
    .maybeSingle();

  if (error) {
    console.error('[whatsapp webhook] failed to resolve channel by phone_number_id', phoneNumberId, error);
    return null;
  }

  if (!channel) {
    console.error('[whatsapp webhook] no active whatsapp channel found for phone_number_id', phoneNumberId);
    return null;
  }

  return channel;
}

async function resolveWhatsAppChannelForPhoneNumber(admin: ReturnType<typeof getAdmin>, phoneNumber: string | undefined | null, phoneNumberId: string | undefined | null) {
  if (phoneNumberId) {
    const { data: channel, error } = await admin
      .from('channels')
      .select('id, org_id, credentials')
      .eq('type', 'whatsapp')
      .eq('is_active', true)
      .eq('credentials->>phone_number_id', phoneNumberId)
      .maybeSingle();

    if (!error && channel) {
      return channel;
    }
  }

  if (phoneNumber) {
    const { data: lead, error } = await admin
      .from('leads')
      .select('channel_id')
      .eq('external_id', phoneNumber)
      .maybeSingle();

    if (!error && lead?.channel_id) {
      const { data: channel, error: channelError } = await admin
        .from('channels')
        .select('id, org_id, credentials')
        .eq('type', 'whatsapp')
        .eq('is_active', true)
        .eq('id', lead.channel_id)
        .maybeSingle();

      if (!channelError && channel) {
        return channel;
      }
    }
  }

  const { data: channels, error: channelsError } = await admin
    .from('channels')
    .select('id, org_id, credentials')
    .eq('type', 'whatsapp')
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (!channelsError && Array.isArray(channels) && channels.length === 1) {
    return channels[0];
  }

  return null;
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

export async function processIncomingWhatsAppMessage(body: any) {
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
    const webhookPhoneNumberId = value?.metadata?.phone_number_id;
    const normalizedPhoneNumber = String(phoneNumber).replace(/^\+/, '');
    const processingLockKey = `whatsapp:${webhookPhoneNumberId ?? 'unknown'}:${normalizedPhoneNumber}`;

    await withLeadProcessingLock(processingLockKey, async () => {
      const externalMessageId = `wa_${messageId}`;

      const { data: existingMsg } = await admin
        .from('messages')
        .select('id')
        .eq('external_message_id', externalMessageId)
        .maybeSingle();

      if (existingMsg) {
        return;
      }

      const channel = await resolveWhatsAppChannelForPhoneNumber(admin, phoneNumber, webhookPhoneNumberId);

      if (!channel) {
        console.error('[whatsapp webhook] channel not found for phone_number_id', webhookPhoneNumberId);
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
        .select('id, name, ai_enabled')
        .eq('channel_id', channel.id)
        .eq('external_id', phoneNumber)
        .maybeSingle();

      let leadErr: unknown = null;

      if (!lead) {
        const { data: newLead, error } = await admin
          .from('leads')
          .insert({
            org_id: channel.org_id,
            channel_id: channel.id,
            external_id: phoneNumber,
            name: phoneNumber,
            status: 'new',
            ai_enabled: true,
          })
          .select('id, name, ai_enabled')
          .single();
        leadErr = error;
        lead = newLead;
      }

      if (!lead) {
        if (leadErr) {
          console.error('[whatsapp webhook] Failed to create lead:', leadErr);
        } else {
          console.error('[whatsapp webhook] failed to resolve lead', { phoneNumber });
        }
        return;
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
        .eq('agent_id', agent.id)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!conversation) {
        const { data: newConversation } = await admin
          .from('conversations')
          .insert({ lead_id: lead.id, agent_id: agent.id, is_sandbox: false })
          .select('id')
          .single();
        conversation = newConversation;
      }

      if (!conversation) {
        return;
      }

      const { data: insertedUserMessage } = await admin.from('messages').insert({
        conversation_id: conversation.id,
        sender: 'user',
        content: text,
        external_message_id: externalMessageId,
      }).select('id').single();
      const currentUserMessageId = insertedUserMessage?.id ?? null;

      if (!lead.ai_enabled) {
        return;
      }

      const { data: history } = await admin
        .from('messages')
        .select('sender, content')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: false })
        .limit(10);

      const historyFormatted = (history ?? [])
        .reverse()
        .slice(0, -1)
        .map((message) => ({
          role: (message.sender === 'user' ? 'user' : 'model') as 'user' | 'model',
          text: message.content ?? '',
        }))
        .filter((message) => message.text.length > 0);

      const systemPrompt = agent.system_prompt_compiled ?? `Ты ${agent.name}`;
      const { answer, messageParts, splitMessages, typingSimulation } = await runAgentTurnWithLead(agent.id, systemPrompt, text, historyFormatted, lead.id, currentUserMessageId, { preferRealLead: true });

      const capabilities = agent.general_capabilities ?? {};
      const maxParts = Math.min(3, Math.max(1, Number(capabilities.split_max_parts ?? 2)));
      const fallbackParts = splitAgentMessage(answer, capabilities.split_messages ?? true, maxParts).map((part, index) => ({
        text: part.text,
        delayMs: typingSimulation
          ? Math.max(2000 * index, calculateTypingDelay(part.text) + part.delayMs)
          : Math.max(2000 * index, part.delayMs),
      }));
      const parts = (Array.isArray(messageParts) && messageParts.length > 0
        ? messageParts
        : fallbackParts).slice(0, maxParts);
      const credentials = (channel.credentials as Record<string, unknown> | null) ?? {};
      const phoneNumberId = String(credentials.phone_number_id ?? '');
      const accessToken = String(credentials.access_token ?? '');
      const recipient = phoneNumber.replace(/^\+/, '');

      for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i];
        if (i > 0 && typingSimulation !== false) {
          await new Promise((resolve) => setTimeout(resolve, Math.max(0, part.delayMs)));
        }

        if (phoneNumberId && accessToken) {
          await sendWhatsAppMessage(phoneNumberId, accessToken, recipient, part.text).catch((error) => {
            console.error('[whatsapp webhook] send error', error);
          });
        }
      }
    });
  } catch (error) {
    console.error('[whatsapp webhook]', error);
  }
}
