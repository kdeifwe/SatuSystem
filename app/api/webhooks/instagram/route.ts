import { NextRequest } from 'next/server';
import pino from 'pino';
import { createClient } from '@supabase/supabase-js';
import { runAgentTurnWithLead } from '@/lib/server/ai/orchestrator';
import { splitAgentMessage, calculateTypingDelay } from '@/lib/server/ai/message-splitter';
import { verifyInstagramWebhookSignature, extractInstagramWebhookMessages, getInstagramExternalMessageId, resolveInstagramChannelByRecipientId } from '@/lib/server/instagram-webhook';

const logger = pino({ level: process.env.NODE_ENV === 'development' ? 'info' : 'warn' });

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function normalizeInstagramLeadName(name?: string | null) {
  if (!name) return null;
  const value = String(name).trim();
  return value.length > 0 ? value : null;
}

async function fetchInstagramUserInfo(userId: string) {
  const accessToken = process.env.INSTAGRAM_APP_SECRET;
  if (!accessToken) return null;
  try {
    const response = await fetch(`https://graph.instagram.com/v22.0/${userId}?fields=name,username&access_token=${encodeURIComponent(accessToken)}`);
    if (!response.ok) return null;
    const data = await response.json();
    return { username: data?.username ?? null, name: data?.name ?? null };
  } catch {
    return null;
  }
}

async function getLeadForInstagramChannel(agentId: string, channelId: string, senderId: string, nameHint?: string | null) {
  const client = admin();
  let lead: { id: string; ai_enabled: boolean; attributes?: Record<string, unknown> | null; name?: string | null } | null = null;
  const existingLead = await client
    .from('leads')
    .select('id, ai_enabled, attributes, name')
    .eq('channel_id', channelId)
    .eq('external_id', senderId)
    .maybeSingle();
  lead = existingLead.data as any;

  if (!lead) {
    const payload: Record<string, unknown> = {
      org_id: (await client.from('channels').select('org_id').eq('id', channelId).maybeSingle()).data?.org_id ?? '',
      channel_id: channelId,
      external_id: senderId,
      status: 'new',
      ai_enabled: true,
    };

    const leadName = normalizeInstagramLeadName(nameHint); if (leadName) payload.name = leadName;
    const inserted = await client.from('leads').insert(payload).select('id, ai_enabled').single();
    if (inserted.error || !inserted.data) return null;
    lead = inserted.data as { id: string; ai_enabled: boolean; attributes?: Record<string, unknown> | null; name?: string | null };
  }

  const safeName = normalizeInstagramLeadName(nameHint);
  if (safeName && lead) {
    await client.from('leads').update({
      name: safeName,
      attributes: { ...(lead.attributes as Record<string, unknown> | null) ?? {}, instagram_username: safeName },
    }).eq('id', lead.id);
  }

  return lead;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const verifyToken = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');
  const configuredToken = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && verifyToken && configuredToken && verifyToken === configuredToken) {
    return new Response(challenge ?? 'OK', { status: 200 });
  }

  return new Response('Forbidden', { status: 403 });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-hub-signature-256');
  const appSecret = process.env.INSTAGRAM_APP_SECRET;

  logger.info({ bodySize: rawBody.length }, 'Instagram webhook POST received');
  logger.info({ hasSignature: Boolean(signature) }, 'Instagram webhook signature header present');

  const validSignature = verifyInstagramWebhookSignature(rawBody, signature, appSecret);
  logger.info({ valid: validSignature, hasSignature: Boolean(signature) }, 'Instagram webhook signature result');

  if (!validSignature) {
    return new Response('Unauthorized', { status: 403 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const entryCount = Array.isArray(payload?.entry) ? payload.entry.length : 0;
  const messagingCount = (payload?.entry ?? []).reduce((total: number, entry: any) => total + (Array.isArray(entry?.messaging) ? entry.messaging.length : 0), 0);
  logger.info({ entryCount, messagingCount }, 'Instagram webhook payload summary');

  setImmediate(() => {
    void (async () => {
      try {
        const msgs = extractInstagramWebhookMessages(payload);
        for (const message of msgs) {
          logger.info({ senderId: message.senderId, recipientId: message.recipientId, isEcho: false, textLength: message.text.length }, 'Instagram incoming message details');

          const channel = await resolveInstagramChannelByRecipientId(admin(), message.recipientId);
          logger.info({ recipientId: message.recipientId, found: Boolean(channel) }, 'Instagram channel lookup result');
          if (!channel) continue;

          const externalMessageId = getInstagramExternalMessageId(message.mid);
          const db = admin();
          const { data: existing } = await db.from('messages').select('id').eq('external_message_id', externalMessageId).maybeSingle();
          if (existing) {
            logger.info({ externalMessageId }, 'Instagram webhook duplicate skipped');
            continue;
          }

          const lead = await getLeadForInstagramChannel(channel.org_id ? '' : '', channel.id, message.senderId, null);
          if (!lead) continue;

          const { data: conversation } = await db
            .from('conversations')
            .select('id')
            .eq('lead_id', lead.id)
            .eq('agent_id', channel.credentials?.agent_id ?? '')
            .order('started_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          const conversationId = conversation?.id ?? (await db.from('conversations').insert({ lead_id: lead.id, agent_id: channel.credentials?.agent_id ?? '', is_sandbox: false }).select('id').single()).data?.id;
          if (!conversationId) continue;

          const { data: insertedUserMessage } = await db.from('messages').insert({
            conversation_id: conversationId,
            sender: 'user',
            content: message.text,
            external_message_id: externalMessageId,
          }).select('id').single();

          const { data: history } = await db
            .from('messages')
            .select('sender, content')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .limit(10);

          const historyFormatted = (history ?? []).reverse().slice(0, -1).map((item: any) => ({
            role: item.sender === 'user' ? 'user' : 'model',
            text: item.content ?? '',
          } as any)).filter((item: any) => item.text.length > 0) as any[];

          const { data: agent } = await db.from('agents').select('name, system_prompt_compiled, general_capabilities').eq('id', channel.credentials?.agent_id ?? '').single();
          if (!agent) continue;

          try {
            const result = await runAgentTurnWithLead(
              channel.credentials?.agent_id ?? '',
              agent.system_prompt_compiled ?? `Ты ${agent.name}. Отвечай кратко и по-человечески.`,
              message.text,
              historyFormatted,
              lead.id,
              insertedUserMessage?.id ?? undefined
            );

            const caps = agent.general_capabilities ?? {};
            const maxParts = Math.min(3, Math.max(1, Number(caps.split_max_parts ?? 2)));
            const fallbackParts = splitAgentMessage(result.answer, caps.split_messages ?? true, maxParts).map((part, index) => ({
              text: part.text,
              delayMs: Math.max(2000 * index, calculateTypingDelay(part.text) + part.delayMs),
            }));
            const parts = (Array.isArray(result.messageParts) && result.messageParts.length > 0 ? result.messageParts : fallbackParts).slice(0, maxParts);

            for (let i = 0; i < parts.length; i += 1) {
              const part = parts[i];
              const delayMs = i === 0 ? 2000 : Math.min(1000, Math.max(250, Number(part.delayMs || 500)));
              if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

              try {
                const response = await fetch(`https://graph.instagram.com/v22.0/${channel.credentials?.ig_user_id}/messages`, {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${channel.credentials?.access_token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ recipient: { id: message.senderId }, message: { text: part.text } }),
                });

                logger.info({ recipientId: message.senderId, status: response.status }, 'Instagram outbound send status');

                if (!response.ok) {
                  const errorText = await response.text().catch(() => '');
                  logger.error({ status: response.status, errorMessage: errorText || 'Graph API error' }, 'Instagram outbound send failed');
                }
              } catch (error) {
                logger.error({ senderId: message.senderId, errorMessage: error instanceof Error ? error.message : 'unknown' }, 'Instagram outbound send error');
              }
            }
          } catch (error) {
            logger.error({ agentId: channel.credentials?.agent_id ?? null, errorMessage: error instanceof Error ? error.message : 'unknown' }, 'Instagram runAgentTurnWithLead failed');
          }
        }
      } catch (error) {
        console.error('[instagram webhook] process failed', error);
      }
    })();
  });

  return new Response('OK', { status: 200 });
}
