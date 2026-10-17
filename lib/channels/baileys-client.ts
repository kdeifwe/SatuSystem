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
  downloadMediaMessage,
  WAMessage,
} from '@whiskeysockets/baileys';
import { createAdminClient } from '@/lib/supabase/admin';
import { runAgentTurnWithLead } from '@/lib/server/ai/orchestrator';
import { understandMedia } from '@/lib/server/media-understanding';
import { handleIncomingMessageWithDependencies } from './baileys-handler';
import { splitAgentMessage, calculateTypingDelay } from '@/lib/server/ai/message-splitter';
import { enqueueNotification } from '@/lib/notifications';
import { discoverPersistedAuthAgentIds, getReconnectDelayMs, restoreCredsFromBackupIfNeeded, writeCredsWithBackup } from './baileys-cold-start';

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
  everConnected?: boolean;
  createdAt: number;
  saveCreds?: () => Promise<void>;
}

declare global {
  // eslint-disable-next-line no-var
  var __baileysClients: Map<string, BaileysClientEntry> | undefined;
  // eslint-disable-next-line no-var
  var __baileysClientInitLocks: Map<string, Promise<BaileysClientEntry>> | undefined;
  // eslint-disable-next-line no-var
  var __baileysRestoreStarted: boolean | undefined;
  // eslint-disable-next-line no-var
  var __baileysShutdownBound: boolean | undefined;
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

  for (let index = 0; index < agentIds.length; index += 1) {
    const agentId = agentIds[index];
    let lastAttemptError: unknown;

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      try {
        await createBaileysClient(agentId);
        lastAttemptError = undefined;
        break;
      } catch (error) {
        lastAttemptError = error;
        const delaySeconds = [5, 10, 20, 40, 60, 60, 60, 60][attempt - 1] ?? 60;
        await logSessionRestoreFailure(agentId, `restore_attempt_${attempt}_failed`, error);
        if (attempt < 8) {
          logger.warn({ agentId, attempt, delaySeconds }, 'Retrying persisted WhatsApp restore after delay');
          await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
        }
      }
    }

    if (lastAttemptError) {
      await logSessionRestoreFailure(agentId, 'restore_final_failure', lastAttemptError);
    }

    if (index < agentIds.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

export async function startWhatsAppRestore() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  if (globalThis.__baileysRestoreStarted || process.env.WHATSAPP_RESTORE_ENABLED !== 'true') {
    return;
  }

  globalThis.__baileysRestoreStarted = true;

  try {
    await restorePersistedWhatsAppSessions();
  } catch (error) {
    logger.error({ error }, 'Unhandled error while restoring persisted WhatsApp sessions');
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

function detachSocketListeners(sock: ReturnType<typeof makeWASocket> | undefined) {
  if (!sock) return;

  try {
    sock.ev.removeAllListeners('connection.update');
  } catch (error) {
    logger.warn({ error }, 'Failed to remove connection.update listeners from stale Baileys socket');
  }

  try {
    sock.ev.removeAllListeners('messages.upsert');
  } catch (error) {
    logger.warn({ error }, 'Failed to remove messages.upsert listeners from stale Baileys socket');
  }
}

async function persistCredsSafely(agentId: string, credsPath: string, saveCreds: () => Promise<void>) {
  try {
    await saveCreds();
    try {
      const raw = await fs.readFile(credsPath, 'utf8');
      if (raw) {
        await writeCredsWithBackup(credsPath, raw);
      }
    } catch (error) {
      logger.warn({ agentId, error }, 'Failed to write backup for Baileys creds');
    }
  } catch (error) {
    logger.warn({ agentId, error }, 'Failed to persist Baileys creds');
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
    downloadMedia: async (m) => (await downloadMediaMessage(m, 'buffer', {})) as Buffer,
    understandMedia,
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
    await restoreCredsFromBackupIfNeeded(authDir);
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();
    const credsPath = path.join(authDir, 'creds.json');

    const sock = makeWASocket({
      logger,
      printQRInTerminal: false,
      auth: state,
      version,
      browser: ['SatuSystem', 'Baileys', '1.0.0'],
    });

    const clientEntry: BaileysClientEntry = {
      sock,
      status: 'disconnected',
      reconnectAttempts: 0,
      createdAt: Date.now(),
      saveCreds: async () => persistCredsSafely(agentId, credsPath, saveCreds),
    };

    sock.ev.on('creds.update', () => clientEntry.saveCreds?.());

    clientStore.set(agentId, clientEntry);

    sock.ev.on('connection.update', async (update) => {
      if (clientStore.get(agentId)?.sock !== sock) {
        return;
      }

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
        clientEntry.everConnected = true;
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
        const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
        const isReplaced = statusCode === DisconnectReason.connectionReplaced || statusCode === 440;
        const lastErrorMessage = update.lastDisconnect?.error?.message ?? 'Baileys disconnect';
        console.log(JSON.stringify({ tag: 'WA_CLOSE', agentId, statusCode, reason: lastErrorMessage, isLoggedOut, isReplaced }));

        clientEntry.status = isLoggedOut ? 'error' : 'disconnected';
        clientEntry.qrDataUrl = undefined;
        clientEntry.lastError = lastErrorMessage;
        clientEntry.lastDisconnectTime = Date.now();

        if (clientEntry.reconnectTimer) {
          clearTimeout(clientEntry.reconnectTimer);
          clientEntry.reconnectTimer = undefined;
        }

        if (isLoggedOut) {
          const loggedOutMessage = 'Сессия отозвана на телефоне, отсканируйте QR заново';
          clientEntry.status = 'error';
          clientEntry.lastError = loggedOutMessage;
          await syncChannelConnectionState(agentId, 'error', false);
          // 401 = сессия отозвана: ключи мертвы, чистим, чтобы следующий connect выдал QR
          await clearAuthState(agentId);
          await logSessionRestoreFailure(agentId, 'logged_out', loggedOutMessage);
          return;
        }

        if (isReplaced) {
          clientEntry.status = 'error';
          clientEntry.lastError = 'Сессия открыта в другом месте';
          await syncChannelConnectionState(agentId, 'error', false);
          logger.warn({ agentId, statusCode }, 'Baileys session replaced elsewhere; retrying reconnect with backoff');

          const delayMs = getReconnectDelayMs(clientEntry.reconnectAttempts + 1, 'replaced');
          clientEntry.reconnectAttempts += 1;
          clientEntry.lastReconnectAt = Date.now();
          await logSessionRestoreFailure(agentId, `replace_retry_${clientEntry.reconnectAttempts}`, clientEntry.lastError);
          clientEntry.reconnectTimer = setTimeout(async () => {
            clientStore.delete(agentId);
            try {
              await createBaileysClient(agentId);
            } catch (err) {
              logger.error({ agentId, err }, 'Реконнект для Baileys после replacement не удался');
            }
          }, delayMs);
          return;
        }

        const now = Date.now();
        if (clientEntry.lastReconnectAt && now - clientEntry.lastReconnectAt > 60_000) {
          clientEntry.reconnectAttempts = 0;
        }

        clientEntry.reconnectAttempts += 1;
        clientEntry.lastReconnectAt = now;
        const delayMs = getReconnectDelayMs(clientEntry.reconnectAttempts, 'generic');
        if (clientEntry.lastError) {
          clientEntry.status = 'error';
          await syncChannelConnectionState(agentId, 'error', false);
        } else {
          await syncChannelConnectionState(agentId, 'disconnected', false);
        }

        logger.warn({ agentId, statusCode, attempt: clientEntry.reconnectAttempts, delayMs }, 'Соединение разорвано, переподключение по backoff');

        clientEntry.reconnectTimer = setTimeout(async () => {
          clientStore.delete(agentId);
          try {
            await createBaileysClient(agentId);
          } catch (err) {
            logger.error({ agentId, err }, 'Реконнект для Baileys не удался');
          }
        }, delayMs);
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
  const existing = clientStore.get(agentId);

  if (existing && !options?.forceNewAuth) {
    // Сокет ещё поднимается (после рестарта/реконнекта) — не трогаем его.
    // Раньше тут вызывался logout(), который отзывал сессию на стороне WhatsApp.
    const isStillConnecting = Date.now() - existing.createdAt < 90_000;
    const isStale = (existing.status === 'disconnected' || existing.status === 'error') && !existing.reconnectTimer;

    if (isStale && !isStillConnecting) {
      // Только закрываем транспорт, БЕЗ logout: ключи остаются валидными.
      try { (existing.sock as any)?.end?.(undefined); } catch (err) {
        logger.warn({ agentId, err }, 'Failed to close stale Baileys socket');
      }
      clientStore.delete(agentId);
      clientInitLocks.delete(agentId);
    } else {
      return existing;
    }
  }

  await createBaileysClient(agentId, options?.forceNewAuth ?? false);

  return clientStore.get(agentId)!;
}

export function peekBaileysClient(agentId: string): BaileysClientEntry | undefined {
  return clientStore.get(agentId);
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
  opts: { url?: string; buffer?: Buffer; mimeType?: string; caption?: string; fileName?: string },
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
    message = { document: data, mimetype: mime, fileName: opts.fileName || 'file', caption: opts.caption ?? undefined };
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

if (process.env.WHATSAPP_RESTORE_ENABLED === 'true') {
  void startWhatsAppRestore();
}

const handleShutdown = async () => {
  const shutdownTargets = Array.from(clientStore.values());

  for (const entry of shutdownTargets) {
    try {
      if (typeof (entry.sock as any)?.ws?.close === 'function') {
        (entry.sock as any).ws.close();
      }
      if (typeof (entry.sock as any)?.end === 'function') {
        (entry.sock as any).end();
      }
      if (typeof entry.saveCreds === 'function') {
        await Promise.race([
          entry.saveCreds(),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      }
    } catch (error) {
      logger.warn({ agentId: entry.sock?.user?.id, error }, 'Failed to gracefully close Baileys socket during shutdown');
    }
  }
};

if (!globalThis.__baileysShutdownBound) {
  process.once('SIGINT', () => {
    void handleShutdown();
  });
  process.once('SIGTERM', () => {
    void handleShutdown();
  });
  globalThis.__baileysShutdownBound = true;
}
