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
import { runAgentTurnWithLead } from '@/lib/server/ai/orchestrator';
import { handleIncomingMessageWithDependencies } from './baileys-handler';
import { splitAgentMessage, calculateTypingDelay } from '@/lib/server/ai/message-splitter';
import { enqueueNotification } from '@/lib/notifications';

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
  lastDisconnectTime?: number;
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

export async function resetStaleChannelStatuses() {
  try {
    const admin = createAdminClient();
    await admin
      .from('channels')
      .update({ is_active: false, connection_status: 'disconnected' })
      .eq('type', 'whatsapp');
  } catch (error) {
    logger.warn({ error }, 'Failed to reset WhatsApp channel statuses on cold start');
  }
}

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

export async function handleIncomingMessage(agentId: string, sock: ReturnType<typeof makeWASocket>, message: WAMessage) {
  return handleIncomingMessageWithDependencies(agentId, sock, message, {
    createAdminClient,
    ensureWhatsAppChannel,
    runAgentTurnWithLead,
    logger,
  });
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
      clientEntry.lastDisconnectTime = undefined;
      await syncChannelConnectionState(agentId, 'connected', true);
      return;
    }

    if (update.connection === 'close') {
      const statusCode = (update.lastDisconnect?.error as any)?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;

      clientEntry.status = 'disconnected';
      clientEntry.qrDataUrl = undefined;
      clientEntry.lastError = update.lastDisconnect?.error?.message;
      clientEntry.lastDisconnectTime = Date.now();
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

await resetStaleChannelStatuses();
