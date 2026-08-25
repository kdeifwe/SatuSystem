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
import { discoverPersistedAuthAgentIds } from './baileys-cold-start';

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
  // eslint-disable-next-line no-var
  var __baileysClientInitLocks: Map<string, Promise<BaileysClientEntry>> | undefined;
}

const clientStore = globalThis.__baileysClients ?? new Map<string, BaileysClientEntry>();
globalThis.__baileysClients = clientStore;
const clientInitLocks = globalThis.__baileysClientInitLocks ?? new Map<string, Promise<BaileysClientEntry>>();
globalThis.__baileysClientInitLocks = clientInitLocks;

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

async function logSessionRestoreFailure(agentId: string, reason: string, error?: unknown) {
  const admin = createAdminClient();
  const payload = {
    event: 'whatsapp_session_restore_failed',
    agentId,
    reason,
    errorMessage: error instanceof Error ? error.message : String(error ?? 'unknown'),
  };

  logger.warn({ agentId, reason, error }, 'Failed to restore persisted WhatsApp session on cold start');

  try {
    await admin.from('notification_log').insert({
      agent_id: agentId,
      event_type: 'whatsapp_session_restore_failed',
      payload,
      delivery_status: 'pending',
    });
  } catch (notificationError) {
    logger.error({ agentId, notificationError }, 'Failed to persist WhatsApp session restore failure notification');
  }
}

async function restorePersistedWhatsAppSessions() {
  await resetStaleChannelStatuses();

  const agentIds = await discoverPersistedAuthAgentIds(authRoot);
  if (agentIds.length === 0) {
    logger.info('No persisted WhatsApp auth sessions found for cold-start restore');
    return;
  }

  logger.info({ count: agentIds.length, agentIds }, 'Restoring persisted WhatsApp sessions from disk');

  for (const agentId of agentIds) {
    try {
      await createBaileysClient(agentId);
    } catch (error) {
      await logSessionRestoreFailure(agentId, 'createBaileysClient_failed', error);
    }
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

export async function disconnectBaileysClient(agentId: string): Promise<BaileysClientInfo> {
  const inFlightInit = clientInitLocks.get(agentId);
  if (inFlightInit) {
    await inFlightInit.catch(() => undefined);
  }

  const existing = clientStore.get(agentId);
  if (existing?.reconnectTimer) {
    clearTimeout(existing.reconnectTimer);
    existing.reconnectTimer = undefined;
  }

  if (existing?.sock) {
    try {
      const logoutHandler = (existing.sock as typeof existing.sock & { logout?: () => Promise<void> }).logout;
      if (typeof logoutHandler === 'function') {
        await logoutHandler.call(existing.sock);
      }
    } catch (error) {
      logger.warn({ agentId, error }, 'Failed to logout Baileys socket');
    }
  }

  clientStore.delete(agentId);
  clientInitLocks.delete(agentId);

  await clearAuthState(agentId);
  await syncChannelConnectionState(agentId, 'disconnected', false);

  return { status: 'disconnected' };
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

  const existingLock = clientInitLocks.get(agentId);
  if (existingLock && !forceNewAuth) {
    return existingLock;
  }

  if (forceNewAuth) {
    await clearAuthState(agentId);
  }

  const initializationPromise = (async () => {
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
          await logSessionRestoreFailure(agentId, 'logged_out', update.lastDisconnect?.error?.message);
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
  })();

  clientInitLocks.set(agentId, initializationPromise);

  try {
    return await initializationPromise;
  } finally {
    clientInitLocks.delete(agentId);
  }
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

// Baileys v7 media message shape: media passed directly, mimetype as sibling
// field (per AnyMediaMessageContent)
export async function sendWhatsAppMedia(
  agentId: string,
  remoteJid: string,
  opts: { url?: string; buffer?: Buffer; mimeType?: string; caption?: string },
) {
  const entry = clientStore.get(agentId);
  if (!entry?.sock) {
    throw new Error('WhatsApp client is not initialized');
  }

  if (entry.status !== 'connected') {
    throw new Error('WhatsApp is not connected');
  }

  let data: Buffer | undefined = opts.buffer;
  if (!data && opts.url) {
    const res = await fetch(opts.url);
    if (!res.ok) throw new Error(`Failed to download media: ${res.status}`);
    data = Buffer.from(await res.arrayBuffer());
  }

  if (!data) throw new Error('No media buffer provided');

  const mime = opts.mimeType ?? 'application/octet-stream';
  let message: any;

  if (mime.startsWith('image/')) {
    // common pattern: { image: <Buffer>, mimetype: 'image/..', caption }
    message = { image: data, mimetype: mime, caption: opts.caption ?? undefined };
  } else if (mime.startsWith('video/')) {
    message = { video: data, mimetype: mime, caption: opts.caption ?? undefined };
  } else {
    // documents (including PDF) as document buffer with filename
    message = { document: data, mimetype: mime, fileName: 'file', caption: opts.caption ?? undefined };
  }

  await entry.sock.sendMessage(remoteJid, message);
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

void restorePersistedWhatsAppSessions();
