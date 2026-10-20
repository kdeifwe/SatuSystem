import pino from 'pino';
import { createAdminClient } from '@/lib/supabase/admin';
import { isValidLeadName } from '@/lib/server/lead-name';
import { withLeadProcessingLock } from '@/lib/server/lead-processing-queue';
import { calculateTypingDelay, splitAgentMessage } from '@/lib/server/ai/message-splitter';
import type { AgentTurnResult, ChatMessage } from '@/lib/server/ai/orchestrator';

const baseLogger = pino({ level: process.env.NODE_ENV === 'development' ? 'info' : 'warn' });

export interface InstagramInboundPayload {
  channel_id: string;
  thread_id: string;
  sender_id: string;
  sender_username: string | null;
  sender_name: string | null;
  message_id: string;
  text: string;
  timestamp: string | null;
}

export type InstagramProcessResult =
  | 'processed'
  | 'duplicate'
  | 'ai_disabled'
  | 'ignored'
  | 'error';

type AdminClient = ReturnType<typeof createAdminClient>;

export interface InstagramProcessorDeps {
  createAdminClient: () => AdminClient;
  runAgentTurnWithLead: (
    agentId: string,
    systemPrompt: string,
    userMessage: string,
    history: ChatMessage[],
    externalLeadId: string,
    userMessageId?: string,
  ) => Promise<AgentTurnResult>;
  sendText: (agentId: string, threadId: string, text: string) => Promise<void>;
  withLock: <T>(key: string, callback: () => Promise<T>) => Promise<T>;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  logger: Pick<typeof baseLogger, 'info' | 'warn' | 'error'>;
}

export function defaultInstagramProcessorDeps(): InstagramProcessorDeps {
  return {
    createAdminClient,
    // динамические импорты: оркестратор тяжёлый и не нужен ни роуту подписи, ни тестам
    runAgentTurnWithLead: async (...args) => {
      const mod = await import('@/lib/server/ai/orchestrator');
      return mod.runAgentTurnWithLead(...args);
    },
    sendText: async (agentId, threadId, text) => {
      const mod = await import('@/lib/channels/instagram-client');
      return mod.sendInstagramText(agentId, threadId, text);
    },
    withLock: withLeadProcessingLock,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: Math.random,
    logger: baseLogger,
  };
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function parseInstagramInboundPayload(value: unknown): InstagramInboundPayload | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const channelId = str(raw.channel_id);
  const threadId = str(raw.thread_id);
  const senderId = str(raw.sender_id);
  const messageId = str(raw.message_id);
  const text = str(raw.text);
  if (!channelId || !threadId || !senderId || !messageId || !text) return null;
  return {
    channel_id: channelId,
    thread_id: threadId,
    sender_id: senderId,
    sender_username: str(raw.sender_username),
    sender_name: str(raw.sender_name),
    message_id: messageId,
    text,
    timestamp: str(raw.timestamp),
  };
}

const UNIQUE_VIOLATION = '23505';

export async function processInstagramInbound(
  payload: InstagramInboundPayload,
  deps: InstagramProcessorDeps = defaultInstagramProcessorDeps(),
): Promise<InstagramProcessResult> {
  const { logger } = deps;
  try {
    const admin = deps.createAdminClient();

    const { data: channel } = await admin
      .from('channels')
      .select('id, org_id, credentials')
      .eq('id', payload.channel_id)
      .eq('type', 'instagram')
      .maybeSingle();

    const credentials = (channel?.credentials ?? {}) as Record<string, unknown>;
    const agentId = typeof credentials.agent_id === 'string' ? credentials.agent_id : null;
    if (!channel || !agentId) {
      logger.warn({ channelId: payload.channel_id }, 'Instagram inbound for unknown channel or channel without agent');
      return 'ignored';
    }

    return await deps.withLock(`instagram:${channel.id}:${payload.thread_id}`, () =>
      handleMessage(admin, deps, { channelId: channel.id as string, orgId: channel.org_id as string, agentId }, payload),
    );
  } catch (error) {
    logger.error({ errorName: error instanceof Error ? error.name : 'unknown', message: error instanceof Error ? error.message : String(error) }, 'Failed to process Instagram inbound message');
    return 'error';
  }
}

async function handleMessage(
  admin: AdminClient,
  deps: InstagramProcessorDeps,
  ctx: { channelId: string; orgId: string; agentId: string },
  payload: InstagramInboundPayload,
): Promise<InstagramProcessResult> {
  const { logger } = deps;
  const { channelId, orgId, agentId } = ctx;
  const username = payload.sender_username && isValidLeadName(payload.sender_username) ? payload.sender_username : null;

  // --- лид (один на тред)
  let { data: lead } = await admin
    .from('leads')
    .select('id, ai_enabled, attributes, name')
    .eq('channel_id', channelId)
    .eq('external_id', payload.thread_id)
    .maybeSingle();

  if (!lead) {
    const insertPayload: Record<string, unknown> = {
      org_id: orgId,
      channel_id: channelId,
      external_id: payload.thread_id,
      status: 'new',
      ai_enabled: true,
      attributes: username ? { instagram_username: username } : {},
    };
    if (username) insertPayload.name = username;
    const { data: created, error } = await admin.from('leads').insert(insertPayload).select('id, ai_enabled, attributes, name').single();
    if (error && (error as { code?: string }).code === UNIQUE_VIOLATION) {
      const { data: existing } = await admin
        .from('leads')
        .select('id, ai_enabled, attributes, name')
        .eq('channel_id', channelId)
        .eq('external_id', payload.thread_id)
        .maybeSingle();
      lead = existing;
    } else if (error || !created) {
      logger.error({ agentId, error: error?.message }, 'Failed to create Instagram lead');
      return 'error';
    } else {
      lead = created;
    }
  } else if (username) {
    const attributes = (lead.attributes ?? {}) as Record<string, unknown>;
    if (attributes.instagram_username !== username) {
      const update: Record<string, unknown> = { attributes: { ...attributes, instagram_username: username } };
      if (!lead.name) update.name = username;
      await admin.from('leads').update(update).eq('id', lead.id);
    }
  }
  if (!lead) return 'error';

  // --- диалог
  let { data: conversation } = await admin
    .from('conversations')
    .select('id')
    .eq('lead_id', lead.id)
    .eq('agent_id', agentId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conversation) {
    const { data: created, error } = await admin
      .from('conversations')
      .insert({ lead_id: lead.id, agent_id: agentId, is_sandbox: false })
      .select('id')
      .single();
    if (error || !created) {
      logger.error({ agentId, error: error?.message }, 'Failed to create Instagram conversation');
      return 'error';
    }
    conversation = created;
  }

  // --- сообщение клиента; дубль определяется unique-индексом, а не предварительным select
  const { data: inserted, error: insertError } = await admin
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      sender: 'user',
      content: payload.text,
      external_message_id: `ig_${payload.message_id}`,
    })
    .select('id')
    .single();

  if (insertError) {
    if ((insertError as { code?: string }).code === UNIQUE_VIOLATION) return 'duplicate';
    logger.error({ agentId, error: insertError.message }, 'Failed to store Instagram user message');
    return 'error';
  }

  if (!lead.ai_enabled) return 'ai_disabled';

  // --- ответ ИИ
  const { data: history } = await admin
    .from('messages')
    .select('sender, content')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: false })
    .limit(10);

  const historyFormatted: ChatMessage[] = ((history ?? []) as Array<{ sender: string; content: string | null }>)
    .reverse()
    .slice(0, -1)
    .map((item) => ({ role: (item.sender === 'user' ? 'user' : 'model') as 'user' | 'model', text: item.content ?? '' }))
    .filter((item) => item.text.length > 0);

  const { data: agent } = await admin
    .from('agents')
    .select('name, system_prompt_compiled, general_capabilities')
    .eq('id', agentId)
    .single();
  if (!agent) {
    logger.error({ agentId }, 'Agent record not found for Instagram message');
    return 'error';
  }

  const systemPrompt = agent.system_prompt_compiled ?? `Ты ${agent.name}. Отвечай кратко и по-человечески.`;
  const turn = await deps.runAgentTurnWithLead(agentId, systemPrompt, payload.text, historyFormatted, lead.id, inserted?.id ?? undefined);

  const caps = (agent.general_capabilities ?? {}) as { split_max_parts?: number; split_messages?: boolean };
  const maxParts = Math.min(3, Math.max(1, Number(caps.split_max_parts ?? 2)));
  const fallbackParts = splitAgentMessage(turn.answer, caps.split_messages ?? true, maxParts).map((part, index) => ({
    text: part.text,
    delayMs: turn.typingSimulation
      ? Math.max(2000 * index, calculateTypingDelay(part.text) + part.delayMs)
      : Math.max(2000 * index, part.delayMs),
  }));
  const parts = (Array.isArray(turn.messageParts) && turn.messageParts.length > 0 ? turn.messageParts : fallbackParts).slice(0, maxParts);

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part.text?.trim()) continue;
    const delayMs = i === 0 ? Math.floor(deps.random() * 4001) + 2000 : Math.min(1000, Math.max(250, part.delayMs || 500));
    await deps.sleep(delayMs);
    try {
      await deps.sendText(agentId, payload.thread_id, part.text);
    } catch (error) {
      logger.error({ agentId, part: i, message: error instanceof Error ? error.message : String(error) }, 'Failed to send Instagram reply');
      return 'error';
    }
  }

  return 'processed';
}
