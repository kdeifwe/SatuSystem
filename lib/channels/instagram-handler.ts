import { splitAgentMessage, calculateTypingDelay } from '@/lib/server/ai/message-splitter';
import { isValidLeadName } from '@/lib/server/lead-name';
import { runAgentTurnWithLead } from '@/lib/server/ai/orchestrator';

export interface InstagramEventMessage {
  item_id?: string;
  thread_id?: string;
  user_id?: string | number;
  text?: string;
  item_type?: string;
  path?: string;
  message?: InstagramEventMessage;
}

export interface InstagramHandlerDeps {
  createAdminClient: () => any;
  ensureInstagramChannel: (agentId: string) => Promise<any>;
  runAgentTurnWithLead: typeof runAgentTurnWithLead;
  logger?: { error: (meta: any, message: string) => void };
  getSenderInfo?: (userId: string | number) => Promise<{ username?: string | null; full_name?: string | null } | null>;
  sendText?: (agentId: string, threadId: string, text: string) => Promise<void>;
}

export async function handleIncomingMessageWithDependencies(
  agentId: string,
  ig: any,
  message: InstagramEventMessage,
  deps: InstagramHandlerDeps
) {
  const logger = deps.logger ?? { error: () => undefined };

  try {
    const normalizedMessage = (message as any)?.message ?? message;
    const threadId = String(normalizedMessage?.thread_id ?? normalizedMessage?.thread ?? '');
    const itemId = String(normalizedMessage?.item_id ?? normalizedMessage?.mid ?? '');
    const text = typeof normalizedMessage?.text === 'string' ? normalizedMessage.text.trim() : '';
    const userId = normalizedMessage?.user_id ?? normalizedMessage?.sender?.id;

    if (normalizedMessage?.is_echo) return;
    if (!threadId || !itemId || !text) return;
    if (String(userId) === String(ig?.state?.cookieUserId)) return;

    const admin = deps.createAdminClient();
    const channel = await deps.ensureInstagramChannel(agentId);
    const externalMessageId = `ig_${itemId}`;

    const { data: existingMsg } = await admin.from('messages').select('id').eq('external_message_id', externalMessageId).maybeSingle();
    if (existingMsg) return;

    let senderUsername = '';
    if (deps.getSenderInfo) {
      const senderInfo = await deps.getSenderInfo(userId ?? threadId);
      senderUsername = typeof senderInfo?.username === 'string' ? senderInfo.username.trim() : '';
    }
    if (!senderUsername) {
      senderUsername = String((ig?.user?.getInfo ? await ig.user.getInfo(userId as any).catch(() => null) : null)?.username ?? '').trim();
    }
    const safeLeadName = senderUsername && isValidLeadName(senderUsername) ? senderUsername : null;

    let { data: lead } = await admin
      .from('leads')
      .select('id, ai_enabled, attributes, name')
      .eq('channel_id', channel.id)
      .eq('external_id', threadId)
      .maybeSingle();

    if (!lead) {
      const insertPayload: any = {
        org_id: channel.org_id,
        channel_id: channel.id,
        external_id: threadId,
        status: 'new',
        ai_enabled: true,
      };
      if (safeLeadName) insertPayload.name = safeLeadName;
      const { data: newLead, error: leadError } = await admin.from('leads').insert(insertPayload).select('id, ai_enabled').single();
      if (!newLead || leadError) {
        logger.error({ agentId, error: leadError }, 'Failed to create Instagram lead');
        return;
      }
      lead = newLead;
    } else if (safeLeadName && isValidLeadName(safeLeadName)) {
      const existingAttrs = (lead.attributes as Record<string, unknown> | null) ?? {};
      const updatePayload: any = { attributes: { ...existingAttrs, instagram_username: safeLeadName } };
      if (isValidLeadName(safeLeadName)) updatePayload.name = safeLeadName;
      await admin.from('leads').update(updatePayload).eq('id', lead.id);
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
        logger.error({ agentId, error: convError }, 'Failed to create Instagram conversation');
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

    if (!lead.ai_enabled) return;

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

    const { data: agent } = await admin.from('agents').select('name, system_prompt_compiled, general_capabilities').eq('id', agentId).single();
    if (!agent) {
      logger.error({ agentId }, 'Agent record not found for Instagram message');
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
    const fallbackParts = splitAgentMessage(answer, caps.split_messages ?? true, maxParts).map((part, index) => ({
      text: part.text,
      delayMs: typingSimulation
        ? Math.max(2000 * index, calculateTypingDelay(part.text) + part.delayMs)
        : Math.max(2000 * index, part.delayMs),
    }));
    const parts = (Array.isArray(messageParts) && messageParts.length > 0 ? messageParts : fallbackParts).slice(0, maxParts);

    const sender = deps.sendText ?? ((_, __, ___) => Promise.resolve());
    const minDelayMs = 2000;
    const maxDelayMs = 6000;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const delayMs = i === 0 ? Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs : Math.min(1000, Math.max(250, part.delayMs || 500));
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      await sender(agentId, threadId, part.text);
    }
  } catch (error) {
    logger.error({ agentId, error }, 'Failed to process incoming Instagram message');
  }
}
