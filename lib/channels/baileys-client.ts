import { promises as fs } from 'node:fs';
import path from 'node:path';
import qrcode from 'qrcode';
import pino from 'pino';
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  proto,
  WAMessage,
} from '@whiskeysockets/baileys';
import { createAdminClient } from '@/lib/supabase/admin';
import { runAgentTurn } from '@/lib/server/ai/orchestrator';
import { splitAgentMessage, calculateTypingDelay } from '@/lib/server/ai/message-splitter';

const { normalizeConnectionStatus, buildChannelStatusUpdate } = require('@/lib/channels/status-utils');

export type BaileysStatus = 'qr' | 'connected' | 'disconnected' | 'error';

export interface BaileysClientInfo {
  status: BaileysStatus;
  qrDataUrl?: string;
  jid?: string;
  lastError?: string;
}

interface BaileysClientEntry extends BaileysClientInfo {
  sock: ReturnType<typeof makeWASocket>;
  reconnectAttempts: number;
  lastReconnectAt?: number;
  reconnectTimer?: ReturnType<typeof setTimeout>;
}

declare global {
  // eslint-disable-next-line no-var
  var __baileysClients: Map<string, BaileysClientEntry> | undefined;
}

const clientStore = globalThis.__baileysClients ?? new Map<string, BaileysClientEntry>();
globalThis.__baileysClients = clientStore;

const authRoot = path.join(process.cwd(), 'baileys-auth');
const logger = pino({ level: process.env.NODE_ENV === 'development' ? 'info' : 'warn' });

(async () => {
  try {
    const admin = createAdminClient();
    await admin
      .from('channels')
      .update({ is_active: false, connection_status: 'disconnected' })
      .eq('type', 'whatsapp');
  } catch (error) {
    logger.warn({ error }, 'Failed to reset WhatsApp channel statuses on cold start');
  }
})();

async function ensureAuthDir(agentId: string) {
  const dir = path.join(authRoot, agentId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function clearAuthState(agentId: string) {
  const dir = path.join(authRoot, agentId);
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (error) {
    logger.warn({ agentId, error }, 'Failed to clear Baileys auth state');
  }
}

async function ensureWhatsAppChannel(agentId: string) {
  const admin = createAdminClient();
  const { data: agent, error: agentError } = await admin
    .from('agents')
    .select('org_id')
    .eq('id', agentId)
    .single();

  if (agentError || !agent?.org_id) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  const { data: existingChannel, error: existingError } = await admin
    .from('channels')
    .select('id, org_id, credentials, is_active, connection_status')
    .eq('org_id', agent.org_id)
    .eq('type', 'whatsapp')
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to load WhatsApp channel: ${existingError.message}`);
  }

  if (existingChannel) {
    return existingChannel;
  }

  const { data: createdChannel, error: createError } = await admin
    .from('channels')
    .insert({
      org_id: agent.org_id,
      type: 'whatsapp',
      credentials: {},
      is_active: false,
      connection_status: 'disconnected',
    })
    .select('id, org_id, credentials, is_active, connection_status')
    .single();

  if (createError || !createdChannel) {
    throw new Error(`Failed to create WhatsApp channel: ${createError?.message}`);
  }

  return createdChannel;
}

async function syncChannelConnectionState(agentId: string, connectionStatus: BaileysStatus, active: boolean) {
  try {
    const normalizedStatus = normalizeConnectionStatus(connectionStatus);
    const payload = buildChannelStatusUpdate(normalizedStatus, active);
    const admin = createAdminClient();
    const { data: agent } = await admin
      .from('agents')
      .select('org_id')
      .eq('id', agentId)
      .single();

    if (!agent?.org_id) return;

    await admin
      .from('channels')
      .update(payload)
      .eq('org_id', agent.org_id)
      .eq('type', 'whatsapp');
  } catch (error) {
    logger.error({ agentId, error }, 'Failed to update WhatsApp channel connection state');
  }
}

function extractText(message: any): string | null {
  if (!message) return null;
  if (typeof message.conversation === 'string') return message.conversation;
  if (typeof message.text === 'string') return message.text;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  if (message.buttonsResponseMessage?.selectedButtonId) return message.buttonsResponseMessage.selectedButtonId;
  if (message.templateButtonReplyMessage?.selectedId) return message.templateButtonReplyMessage.selectedId;
  if (message.listResponseMessage?.singleSelectReply?.selectedRowId) return message.listResponseMessage.singleSelectReply.selectedRowId;
  if (message.ephemeralMessage?.message) return extractText(message.ephemeralMessage.message);
  return null;
}

async function handleIncomingMessage(agentId: string, sock: ReturnType<typeof makeWASocket>, message: WAMessage) {
  try {
    if (message.key?.fromMe) return;
    const remoteJid = String(message.key?.remoteJid ?? '');
    if (!remoteJid) return;

    const text = extractText(message.message);
    if (!text || text.trim().length === 0) return;

    const admin = createAdminClient();
    const channel = await ensureWhatsAppChannel(agentId);

    const externalMessageId = `wa_${message.key.id ?? Date.now()}`;
    const { data: existingMsg } = await admin
      .from('messages')
      .select('id')
      .eq('external_message_id', externalMessageId)
      .maybeSingle();

    if (existingMsg) return;

    const userName = message.pushName ?? remoteJid;
    let { data: lead } = await admin
      .from('leads')
      .select('id, ai_enabled')
      .eq('channel_id', channel.id)
      .eq('external_id', remoteJid)
      .maybeSingle();

    if (!lead) {
      const { data: newLead, error: leadError } = await admin
        .from('leads')
        .insert({
          org_id: channel.org_id,
          channel_id: channel.id,
          external_id: remoteJid,
          name: userName,
          status: 'new',
          ai_enabled: true,
        })
        .select('id, ai_enabled')
        .single();

      if (!newLead || leadError) {
        logger.error({ agentId, error: leadError }, 'Failed to create WhatsApp lead');
        return;
      }
      lead = newLead;
    }

    let { data: conversation } = await admin
      .from('conversations')
      .select('id')
      .eq('lead_id', lead.id)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conversation) {
      const { data: newConversation, error: convError } = await admin
        .from('conversations')
        .insert({ lead_id: lead.id, agent_id: agentId })
        .select('id')
        .single();

      if (!newConversation || convError) {
        logger.error({ agentId, error: convError }, 'Failed to create WhatsApp conversation');
        return;
      }
      conversation = newConversation;
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
      .map((messageItem) => ({
        role: messageItem.sender === 'user' ? 'user' : 'model' as 'user' | 'model',
        text: messageItem.content ?? '',
      }))
      .filter((item) => item.text.length > 0);

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
    const { answer } = await runAgentTurn(agentId, systemPrompt, text, historyFormatted);

    const caps = agent.general_capabilities ?? {};
    const parts = splitAgentMessage(answer, caps.split_messages ?? true, caps.split_max_parts ?? 2);

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (i > 0 && caps.typing_simulation !== false) {
        const delay = calculateTypingDelay(part.text);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      await sock.sendMessage(remoteJid, { text: part.text });
      await admin.from('messages').insert({
        conversation_id: conversation.id,
        sender: 'ai',
        content: part.text,
        external_message_id: `wa_ai_${message.key.id ?? Date.now()}_${i}`,
      });
    }
  } catch (error) {
    logger.error({ agentId, error }, 'Failed to process incoming WhatsApp message');
  }
}

async function createBaileysClient(agentId: string, forceNewAuth = false) {
  if (clientStore.has(agentId) && !forceNewAuth) {
    return clientStore.get(agentId)!;
  }

  if (forceNewAuth) {
    await clearAuthState(agentId);
  }

  await ensureAuthDir(agentId);
  await ensureWhatsAppChannel(agentId);

  const authDir = path.join(authRoot, agentId);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    logger,
    printQRInTerminal: false,
    auth: state,
    version,
    browser: ['SatuSystem', 'Baileys', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  const clientEntry: BaileysClientEntry = {
    sock,
    status: 'disconnected',
    reconnectAttempts: 0,
  };

  clientStore.set(agentId, clientEntry);

  sock.ev.on('connection.update', async (update) => {
    if (update.qr) {
      if (clientEntry.reconnectTimer) {
        clearTimeout(clientEntry.reconnectTimer);
        clientEntry.reconnectTimer = undefined;
      }
      clientEntry.status = 'qr';
      clientEntry.qrDataUrl = await qrcode.toDataURL(update.qr);
      clientEntry.lastError = undefined;
      await syncChannelConnectionState(agentId, 'qr', false);
      return;
    }

    if (update.connection === 'open') {
      if (clientEntry.reconnectTimer) {
        clearTimeout(clientEntry.reconnectTimer);
        clientEntry.reconnectTimer = undefined;
      }
      clientEntry.status = 'connected';
      clientEntry.jid = sock.user?.id;
      clientEntry.qrDataUrl = undefined;
      clientEntry.lastError = undefined;
      clientEntry.reconnectAttempts = 0;
      clientEntry.lastReconnectAt = undefined;
      await syncChannelConnectionState(agentId, 'connected', true);
      return;
    }

    if (update.connection === 'close') {
      const statusCode = (update.lastDisconnect?.error as any)?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;

      clientEntry.status = 'disconnected';
      clientEntry.qrDataUrl = undefined;
      clientEntry.lastError = update.lastDisconnect?.error?.message;
      await syncChannelConnectionState(agentId, 'disconnected', false);

      if (clientEntry.reconnectTimer) {
        clearTimeout(clientEntry.reconnectTimer);
        clientEntry.reconnectTimer = undefined;
      }

      if (isLoggedOut) {
        await clearAuthState(agentId);
        return;
      }

      const now = Date.now();
      if (clientEntry.lastReconnectAt && now - clientEntry.lastReconnectAt > 60_000) {
        clientEntry.reconnectAttempts = 0;
      }

      clientEntry.reconnectAttempts += 1;
      clientEntry.lastReconnectAt = now;

      if (clientEntry.reconnectAttempts > 5) {
        clientEntry.status = 'error';
        clientEntry.lastError = 'Слишком много попыток переподключения, подключите заново вручную';
        await syncChannelConnectionState(agentId, 'error', false);
        logger.error({ agentId, attempts: clientEntry.reconnectAttempts }, 'Baileys reconnect limit exceeded');
        return;
      }

      logger.warn({ agentId, statusCode, attempt: clientEntry.reconnectAttempts }, 'Соединение разорвано, переподключение через 5с');

      clientEntry.reconnectTimer = setTimeout(async () => {
        clientStore.delete(agentId);
        try {
          await createBaileysClient(agentId);
        } catch (err) {
          logger.error({ agentId, err }, 'Реконнект для Baileys не удался');
        }
      }, 5000);
    }
  });

  sock.ev.on('messages.upsert', async (upsert) => {
    if (!Array.isArray(upsert.messages)) return;

    for (const message of upsert.messages) {
      await handleIncomingMessage(agentId, sock, message as WAMessage);
    }
  });

  return clientEntry;
}

export async function getBaileysClient(agentId: string, options?: { forceNewAuth?: boolean }) {
  if (!clientStore.has(agentId) || options?.forceNewAuth) {
    await createBaileysClient(agentId, options?.forceNewAuth ?? false);
  }

  return clientStore.get(agentId)!;
}

export async function sendWhatsAppText(agentId: string, remoteJid: string, content: string) {
  const entry = clientStore.get(agentId);
  if (!entry?.sock) {
    throw new Error('WhatsApp client is not initialized');
  }

  if (entry.status !== 'connected') {
    throw new Error('WhatsApp is not connected');
  }

  await entry.sock.sendMessage(remoteJid, { text: content });
}

export async function getBaileysStatus(agentId: string): Promise<BaileysClientInfo> {
  const existing = clientStore.get(agentId);
  if (existing) {
    return {
      status: existing.status,
      qrDataUrl: existing.qrDataUrl,
      jid: existing.jid,
      lastError: existing.lastError,
    };
  }

  try {
    const admin = createAdminClient();
    const { data: agent } = await admin
      .from('agents')
      .select('org_id')
      .eq('id', agentId)
      .single();

    if (!agent?.org_id) {
      return { status: 'disconnected' };
    }

    const { data: channel } = await admin
      .from('channels')
      .select('connection_status, is_active')
      .eq('org_id', agent.org_id)
      .eq('type', 'whatsapp')
      .maybeSingle();

    const dbStatus = normalizeConnectionStatus(
      channel?.connection_status ?? (channel?.is_active ? 'connected' : 'disconnected')
    );

    return { status: dbStatus };
  } catch (error) {
    logger.warn({ agentId, error }, 'Failed to load WhatsApp status from database');
    return { status: 'disconnected' };
  }
}
