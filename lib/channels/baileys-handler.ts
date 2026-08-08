import type { WAMessage } from '@whiskeysockets/baileys';
import { splitAgentMessage, calculateTypingDelay } from '@/lib/server/ai/message-splitter';
import { isValidLeadName } from '@/lib/server/lead-name';

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
  logger?: { error: (meta: any, message: string) => void };
}

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

export async function handleIncomingMessageWithDependencies(
  agentId: string,
  sock: { sendMessage: (jid: string, content: any) => Promise<any> },
  message: WAMessage,
  deps: BaileysHandlerDeps
) {
  const logger = deps.logger ?? { error: () => undefined };

  try {
    if (message.key?.fromMe) return;
    const remoteJid = String(message.key?.remoteJid ?? '');
    if (!remoteJid) return;

    const text = extractText(message.message);
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

    let { data: lead } = await admin
      .from('leads')
      .select('id, ai_enabled, attributes, name')
      .eq('channel_id', channel.id)
      .eq('external_id', remoteJid)
      .maybeSingle();

    if (!lead) {
      const attrs = rawPushName ? { whatsapp_push_name: rawPushName } : null;
      const insertPayload: any = {
        org_id: channel.org_id,
        channel_id: channel.id,
        external_id: remoteJid,
        status: 'new',
        ai_enabled: true,
      };

      if (attrs) insertPayload.attributes = attrs;
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
      if (rawPushName) {
        const existingAttrs = (lead.attributes as Record<string, unknown> | null) ?? {};
        const mergedAttrs = { ...existingAttrs, whatsapp_push_name: rawPushName };
        const updatePayload: any = { attributes: mergedAttrs };
        if (isValidLeadName(rawPushName)) {
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
      .map((messageItem: any) => ({
        role: messageItem.sender === 'user' ? 'user' : 'model' as 'user' | 'model',
        text: messageItem.content ?? '',
      }))
      .filter((item: { role: 'user' | 'model'; text: string }) => item.text.length > 0);

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
    const { answer, messageParts, splitMessages, typingSimulation } = await deps.runAgentTurnWithLead(
      agentId,
      systemPrompt,
      text,
      historyFormatted,
      lead.id,
      currentUserMessageId ?? undefined
    );

    const caps = agent.general_capabilities ?? {};
    const maxParts = Math.min(3, Math.max(1, Number(caps.split_max_parts ?? 2)));
    const fallbackParts = splitAgentMessage(answer, caps.split_messages ?? true, maxParts).map((part) => ({
      text: part.text,
      delayMs: typingSimulation ? calculateTypingDelay(part.text) + part.delayMs : part.delayMs,
    }));
    const parts = (Array.isArray(messageParts) && messageParts.length > 0
      ? messageParts
      : fallbackParts).slice(0, maxParts);

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const delay = i > 0 && typingSimulation !== false
        ? Math.max(0, part.delayMs)
        : 0;

      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      await sock.sendMessage(remoteJid, { text: part.text });
      // Ответ агента уже сохранён в БД через runAgentTurnWithLead
    }
  } catch (error) {
    logger.error({ agentId, error }, 'Failed to process incoming WhatsApp message');
  }
}
