import type { WAMessage } from '@whiskeysockets/baileys';
import { splitAgentMessage, calculateTypingDelay } from '@/lib/server/ai/message-splitter';
import { isValidLeadName } from '@/lib/server/lead-name';
import { understandMedia, type MediaKind } from '@/lib/server/media-understanding';
import { withLeadProcessingLock } from '@/lib/server/lead-processing-queue';
import { stripLeadingGreeting, hasAssistantReplied } from '@/lib/ai/greeting-guard';
import { createInboundBatcher } from './inbound-batcher';

export interface BaileysHandlerDeps {
  createAdminClient: () => any;
  ensureWhatsAppChannel: (agentId: string) => Promise<any>;
  runAgentTurnWithLead: (
    agentId: string,
    systemPrompt: string,
    userMessage: string,
    history: Array<{ role: 'user' | 'model'; text: string }>,
    leadId: string,
    currentUserMessageId?: string,
    options?: { preferRealLead?: boolean }
  ) => Promise<{ answer: string; messageParts?: Array<{ text: string; delayMs: number }>; splitMessages?: boolean; typingSimulation?: boolean }>;
  downloadMedia?: (message: WAMessage) => Promise<Buffer>;
  understandMedia?: typeof understandMedia;
  logger?: { error: (meta: any, message: string) => void };
  /** Сколько мс тишины ждать после последнего сообщения клиента перед ответом (0 = отвечать сразу). */
  debounceMs?: number;
  /** Потолок ожидания, если клиент пишет без остановки. */
  maxWaitMs?: number;
}

const DEFAULT_DEBOUNCE_MS = Number(process.env.WHATSAPP_DEBOUNCE_MS ?? 7000);
const DEFAULT_MAX_WAIT_MS = Number(process.env.WHATSAPP_DEBOUNCE_MAX_WAIT_MS ?? 25000);

interface PendingMessage {
  agentId: string;
  remoteJid: string;
  leadId: string;
  conversationId: string;
  text: string;
  userMessageId: string | null;
  sock: { sendMessage: (jid: string, content: any) => Promise<any> };
  deps: BaileysHandlerDeps;
}

const batcher = createInboundBatcher<PendingMessage>({
  onFlush: async (_key, items) => {
    await respondToBatch(items);
  },
  onError: (_key, error) => {
    console.error('[baileys-handler] failed to process message batch', error);
  },
});

function extractText(message: any) {
  if (!message) return null;
  if (typeof message.conversation === 'string') return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  if (message.buttonsResponseMessage?.selectedButtonId) return message.buttonsResponseMessage.selectedButtonId;
  if (message.templateButtonReplyMessage?.selectedId) return message.templateButtonReplyMessage.selectedId;
  if (message.listResponseMessage?.singleSelectReply?.selectedRowId) return message.listResponseMessage.singleSelectReply.selectedRowId;
  if (message.ephemeralMessage?.message) return extractText(message.ephemeralMessage.message);
  return null;
}

function unwrapMessage(message: any): any {
  if (message?.ephemeralMessage?.message) return unwrapMessage(message.ephemeralMessage.message);
  if (message?.viewOnceMessage?.message) return unwrapMessage(message.viewOnceMessage.message);
  if (message?.viewOnceMessageV2?.message) return unwrapMessage(message.viewOnceMessageV2.message);
  return message;
}

function detectMedia(message: any): { kind: MediaKind; mimeType: string; caption: string | null } | null {
  const m = unwrapMessage(message);
  if (!m) return null;
  if (m.audioMessage) return { kind: 'audio', mimeType: m.audioMessage.mimetype ?? 'audio/ogg', caption: null };
  if (m.imageMessage) return { kind: 'image', mimeType: m.imageMessage.mimetype ?? 'image/jpeg', caption: m.imageMessage.caption ?? null };
  if (m.videoMessage) return { kind: 'video', mimeType: m.videoMessage.mimetype ?? 'video/mp4', caption: m.videoMessage.caption ?? null };
  return null;
}

async function ingestIncomingMessage(
  agentId: string,
  sock: { sendMessage: (jid: string, content: any) => Promise<any> },
  message: WAMessage,
  deps: BaileysHandlerDeps
): Promise<PendingMessage | undefined> {
  const logger = deps.logger ?? { error: () => undefined };

  try {
    if (message.key?.fromMe) return;
    const remoteJid = String(message.key?.remoteJid ?? '');
    if (!remoteJid) return;

    let text = extractText(message.message);

    const media = detectMedia(message.message);
    if (media) {
      try {
        const download = deps.downloadMedia;
        if (!download) throw new Error('downloadMedia dependency is not provided');
        const understand = deps.understandMedia ?? understandMedia;
        const buffer = await download(message);
        console.log(`[WA] media downloaded kind=${media.kind} mime=${media.mimeType} bytes=${buffer.length}`);
        const understood = await understand(buffer, media.mimeType, media.kind, media.caption ?? text);
        console.log(`[WA] media understood kind=${media.kind} chars=${String(understood ?? '').length}`);
        if (understood) text = understood;
      } catch (error) {
        console.error(`[WA] media failed kind=${media.kind} mime=${media.mimeType} reason=${(error instanceof Error ? error.message : String(error)).slice(0, 600)}`);
        logger.error({ agentId, error }, 'Failed to understand WhatsApp media');
        try {
          await sock.sendMessage(remoteJid, { text: 'Извините, не получилось открыть файл, напишите, пожалуйста, текстом' });
        } catch {}
        return;
      }
    }

    if (!text || text.trim().length === 0) return;

    const admin = deps.createAdminClient();
    const channel = await deps.ensureWhatsAppChannel(agentId);

    const externalMessageId = `wa_${message.key.id ?? Date.now()}`;
    const { data: existingMsg } = await admin
      .from('messages')
      .select('id')
      .eq('external_message_id', externalMessageId)
      .maybeSingle();

    if (existingMsg) return;

    const rawPushName = message.pushName ?? null;
    const userName = typeof rawPushName === 'string' && rawPushName.trim().length > 0 ? rawPushName.trim() : remoteJid;

    const altJid = String((message.key as any)?.remoteJidAlt ?? '');
    const phoneJid = remoteJid.endsWith('@s.whatsapp.net') ? remoteJid : altJid.endsWith('@s.whatsapp.net') ? altJid : '';
    let whatsappPhone = phoneJid ? phoneJid.split('@')[0].split(':')[0] : null;

    const hasLidMappingHook = Boolean((sock as any)?.signalRepository?.lidMapping?.getPNForLID);

    if (!whatsappPhone && remoteJid.endsWith('@lid') && hasLidMappingHook) {
      try {
        const pn = await (sock as any)?.signalRepository?.lidMapping?.getPNForLID?.(remoteJid);
        const d = String(pn ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');
        if (d.length >= 7 && d.length <= 15) {
          whatsappPhone = d;
        }
      } catch {
        // Baileys v7+ fallback is optional and not required for the main flow.
      }
    }

    let { data: lead } = await admin
      .from('leads')
      .select('id, ai_enabled, attributes, name')
      .eq('channel_id', channel.id)
      .eq('external_id', remoteJid)
      .maybeSingle();

    if (!lead) {
      const attrs = {
        ...(rawPushName ? { whatsapp_push_name: rawPushName } : {}),
        ...(whatsappPhone ? { whatsapp_phone: whatsappPhone } : {}),
      };
      const insertPayload: any = {
        org_id: channel.org_id,
        channel_id: channel.id,
        external_id: remoteJid,
        status: 'new',
        ai_enabled: true,
      };

      if (Object.keys(attrs).length > 0) insertPayload.attributes = attrs;
      if (rawPushName && isValidLeadName(rawPushName)) insertPayload.name = rawPushName;
      // if name invalid, leave DB default (e.g. "Новый лид")

      const { data: newLead, error: leadError } = await admin
        .from('leads')
        .insert(insertPayload)
        .select('id, ai_enabled')
        .single();

      if (!newLead || leadError) {
        logger.error({ agentId, error: leadError }, 'Failed to create WhatsApp lead');
        return;
      }
      lead = newLead;
    } else {
      // Existing lead: persist raw pushName in attributes for audit/history
      if (rawPushName || whatsappPhone) {
        const existingAttrs = (lead.attributes as Record<string, unknown> | null) ?? {};
        const mergedAttrs = {
          ...existingAttrs,
          ...(rawPushName ? { whatsapp_push_name: rawPushName } : {}),
          ...(whatsappPhone ? { whatsapp_phone: whatsappPhone } : {}),
        };
        const updatePayload: any = { attributes: mergedAttrs };
        if (rawPushName && isValidLeadName(rawPushName)) {
          updatePayload.name = rawPushName;
        }
        try {
          await admin.from('leads').update(updatePayload).eq('id', lead.id);
        } catch (e) {
          logger.error({ agentId, error: e }, 'Failed to update lead attributes with whatsapp pushName');
        }
      }
    }

    let { data: conversation } = await admin
      .from('conversations')
      .select('id')
      .eq('lead_id', lead.id)
      .eq('agent_id', agentId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conversation) {
      const { data: newConversation, error: convError } = await admin
        .from('conversations')
        .insert({ lead_id: lead.id, agent_id: agentId, is_sandbox: false })
        .select('id')
        .single();

      if (!newConversation || convError) {
        logger.error({ agentId, error: convError }, 'Failed to create WhatsApp conversation');
        return;
      }
      conversation = newConversation;
    }

    const { data: insertedUserMessage } = await admin.from('messages').insert({
      conversation_id: conversation.id,
      sender: 'user',
      content: text,
      external_message_id: externalMessageId,
    }).select('id').single();
    const currentUserMessageId: string | null = insertedUserMessage?.id ?? null;

    if (!lead.ai_enabled) {
      return;
    }

    return {
      agentId,
      remoteJid,
      leadId: lead.id as string,
      conversationId: conversation.id as string,
      text,
      userMessageId: currentUserMessageId,
      sock,
      deps,
    } satisfies PendingMessage;
  } catch (error) {
    logger.error({ agentId, error }, 'Failed to process incoming WhatsApp message');
  }
}

async function sendReplyParts(
  sock: PendingMessage['sock'],
  remoteJid: string,
  parts: Array<{ text: string; delayMs: number }>,
  typingSimulation: boolean | undefined
) {
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const delay = i > 0 && typingSimulation !== false
      ? Math.min(500, Math.max(100, part.delayMs || 100))
      : 0;

    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    await sock.sendMessage(remoteJid, { text: part.text });
    // Ответ агента уже сохранён в БД через runAgentTurnWithLead
  }
}

async function respondToBatch(items: PendingMessage[], options: { recheckAiEnabled?: boolean } = {}) {
  const last = items[items.length - 1];
  if (!last) return;

  const { agentId, remoteJid, leadId, conversationId, sock, deps } = last;
  const logger = deps.logger ?? { error: () => undefined };

  try {
    const admin = deps.createAdminClient();

    if (options.recheckAiEnabled !== false && items.length > 0 && (deps.debounceMs ?? DEFAULT_DEBOUNCE_MS) > 0) {
      const { data: freshLead } = await admin
        .from('leads')
        .select('ai_enabled')
        .eq('id', leadId)
        .maybeSingle();
      if (freshLead && freshLead.ai_enabled === false) return;
    }

    const combinedText = items.map((item) => item.text.trim()).filter(Boolean).join('\n');
    if (!combinedText) return;

    const batchMessageIds = new Set(items.map((item) => item.userMessageId).filter(Boolean) as string[]);
    const currentUserMessageId = last.userMessageId;

    const { data: history } = await admin
      .from('messages')
      .select('id, sender, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(10 + items.length);

    let historyRows: any[] = (history ?? []).slice().reverse();
    if (batchMessageIds.size > 0 && historyRows.some((row) => row?.id && batchMessageIds.has(row.id))) {
      historyRows = historyRows.filter((row) => !(row?.id && batchMessageIds.has(row.id)));
    } else {
      historyRows = historyRows.slice(0, -1);
    }

    const historyFormatted = historyRows
      .map((messageItem: any) => ({
        role: messageItem.sender === 'user' ? 'user' : 'model' as 'user' | 'model',
        text: messageItem.content ?? '',
      }))
      .filter((item: { role: 'user' | 'model'; text: string }) => item.text.length > 0)
      .slice(-10);

    const alreadyGreeted = hasAssistantReplied(historyFormatted);

    const { data: agent } = await admin
      .from('agents')
      .select('name, system_prompt_compiled, general_capabilities')
      .eq('id', agentId)
      .single();

    if (!agent) {
      logger.error({ agentId }, 'Agent record not found for WhatsApp message');
      return;
    }

    const systemPrompt = agent.system_prompt_compiled ?? `Ты ${agent.name}. Отвечай кратко и по-человечески.`;
    const { answer: rawAnswer, messageParts: rawMessageParts, splitMessages, typingSimulation } = await deps.runAgentTurnWithLead(
      agentId,
      systemPrompt,
      combinedText,
      historyFormatted,
      leadId,
      currentUserMessageId ?? undefined
    );

    const answer = alreadyGreeted ? stripLeadingGreeting(rawAnswer) : rawAnswer;
    let messageParts = rawMessageParts;
    if (alreadyGreeted && Array.isArray(rawMessageParts) && rawMessageParts.length > 0) {
      const stripped = rawMessageParts
        .map((part) => ({ ...part, text: stripLeadingGreeting(part.text) }))
        .filter((part) => part.text.trim().length > 0);
      messageParts = stripped.length > 0 ? stripped : rawMessageParts;
    }

    const caps = agent.general_capabilities ?? {};
    const maxParts = Math.min(3, Math.max(1, Number(caps.split_max_parts ?? 3)));
    const fallbackParts = splitAgentMessage(answer, caps.split_messages ?? true, maxParts).map((part, index) => ({
      text: part.text,
      delayMs: typingSimulation
        ? Math.max(2000 * index, calculateTypingDelay(part.text) + part.delayMs)
        : Math.max(2000 * index, part.delayMs),
    }));
    const parts = (Array.isArray(messageParts) && messageParts.length > 0
      ? messageParts
      : fallbackParts).slice(0, maxParts);

    await sendReplyParts(sock, remoteJid, parts, typingSimulation);
  } catch (error) {
    logger.error({ agentId, error }, 'Failed to process incoming WhatsApp message');
  }
}

export async function handleIncomingMessageWithDependencies(
  agentId: string,
  sock: { sendMessage: (jid: string, content: any) => Promise<any> },
  message: WAMessage,
  deps: BaileysHandlerDeps
) {
  const lockKey = `wa-ingest:${agentId}:${String(message.key?.remoteJid ?? '')}`;

  const pending = await withLeadProcessingLock(lockKey, () =>
    ingestIncomingMessage(agentId, sock, message, deps)
  );
  if (!pending) return;

  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  if (debounceMs <= 0) {
    await respondToBatch([pending], { recheckAiEnabled: false });
    return;
  }

  batcher.add(`${agentId}:${pending.remoteJid}`, pending, {
    debounceMs,
    maxWaitMs: deps.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
  });
}
