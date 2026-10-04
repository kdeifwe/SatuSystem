import pino from 'pino';
import { IgApiClient } from 'instagram-private-api';
import { withRealtime, type IgApiClientRealtime } from 'instagram_mqtt';
import { createAdminClient } from '@/lib/supabase/admin';
import { runAgentTurnWithLead } from '@/lib/server/ai/orchestrator';
import { handleIncomingMessageWithDependencies } from './instagram-handler';

const { normalizeConnectionStatus, buildChannelStatusUpdate } = require('@/lib/channels/status-utils');

export type InstagramStatus = 'connected' | 'disconnected' | 'challenge' | '2fa' | 'error';

export interface InstagramClientInfo {
  status: InstagramStatus;
  lastError?: string;
  username?: string;
  challengeType?: 'challenge' | '2fa';
}

interface InstagramClientEntry extends InstagramClientInfo {
  client: IgApiClientRealtime;
  reconnectAttempts: number;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  lastReconnectAt?: number;
  username?: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __instagramClients: Map<string, InstagramClientEntry> | undefined;
  // eslint-disable-next-line no-var
  var __instagramClientInitLocks: Map<string, Promise<InstagramClientEntry>> | undefined;
}

const clientStore = globalThis.__instagramClients ?? new Map<string, InstagramClientEntry>();
globalThis.__instagramClients = clientStore;
const clientInitLocks = globalThis.__instagramClientInitLocks ?? new Map<string, Promise<InstagramClientEntry>>();
globalThis.__instagramClientInitLocks = clientInitLocks;

const logger = pino({ level: process.env.NODE_ENV === 'development' ? 'info' : 'warn' });

function getInstagramFriendlyError(error: unknown, fallback: string): string {
  const rawText = error instanceof Error ? error.message : String(error ?? '');
  const message = rawText.toLowerCase();

  if (message.includes('two factor') || message.includes('2fa') || message.includes('twofactor')) {
    return 'Instagram требует код подтверждения в приложении.';
  }

  if (message.includes('checkpoint') || message.includes('challenge') || message.includes('security')) {
    return 'Instagram запросил проверку безопасности. Введите код из приложения или письма.';
  }

  if (message.includes('password') || message.includes('incorrect') || message.includes('invalid') || message.includes('login')) {
    return 'Неверный логин или пароль Instagram.';
  }

  if (message.includes('verification') || message.includes('code')) {
    return 'Код подтверждения не подходит. Проверьте его и попробуйте снова.';
  }

  return fallback;
}

async function ensureInstagramChannel(agentId: string) {
  const admin = createAdminClient();
  const { data: agent, error: agentError } = await admin
    .from('agents')
    .select('org_id')
    .eq('id', agentId)
    .single();

  if (agentError || !agent?.org_id) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  const { data: existingChannel } = await admin
    .from('channels')
    .select('id, org_id, credentials, is_active, connection_status')
    .eq('org_id', agent.org_id)
    .eq('type', 'instagram')
    .maybeSingle();

  if (existingChannel) {
    return existingChannel;
  }

  const { data: createdChannel, error: createError } = await admin
    .from('channels')
    .insert({
      org_id: agent.org_id,
      type: 'instagram',
      credentials: { agent_id: agentId },
      is_active: false,
      connection_status: 'disconnected',
    })
    .select('id, org_id, credentials, is_active, connection_status')
    .single();

  if (createError || !createdChannel) {
    throw new Error(`Failed to create Instagram channel: ${createError?.message}`);
  }

  return createdChannel;
}

export async function resetStaleInstagramStatuses() {
  try {
    const admin = createAdminClient();
    await admin
      .from('channels')
      .update({ is_active: false, connection_status: 'disconnected' })
      .eq('type', 'instagram');
  } catch (error) {
    logger.warn({ error }, 'Failed to reset Instagram channel statuses on cold start');
  }
}

export async function syncInstagramChannelState(agentId: string, connectionStatus: InstagramStatus, active: boolean) {
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
      .eq('type', 'instagram');
  } catch (error) {
    logger.error({ agentId, error }, 'Failed to update Instagram channel connection state');
  }
}

async function storeInstagramSession(agentId: string, username: string | null | undefined, ig: IgApiClientRealtime) {
  try {
    const admin = createAdminClient();
    const serializedState = await ig.exportState();
    const { data: agent } = await admin.from('agents').select('org_id').eq('id', agentId).single();
    if (!agent?.org_id) return;

    const { data: channel } = await admin
      .from('channels')
      .select('id, credentials')
      .eq('org_id', agent.org_id)
      .eq('type', 'instagram')
      .maybeSingle();

    const previousCredentials = (channel?.credentials as Record<string, unknown> | null) ?? {};
    const nextCredentials = {
      ...previousCredentials,
      agent_id: agentId,
      username: username ?? previousCredentials.username ?? null,
      state: serializedState,
      session_version: 'instagram_mqtt_v1',
    } as Record<string, unknown>;

    await admin
      .from('channels')
      .update({ credentials: nextCredentials, is_active: true, connection_status: 'connected' })
      .eq('id', channel?.id ?? '');
  } catch (error) {
    logger.warn({ agentId, error }, 'Failed to persist Instagram session state');
  }
}

export async function getInstagramStatus(agentId: string): Promise<InstagramClientInfo> {
  const existing = clientStore.get(agentId);
  if (existing) {
    return {
      status: existing.status,
      lastError: existing.lastError,
      username: existing.username,
      challengeType: existing.challengeType,
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
      .select('connection_status, is_active, credentials')
      .eq('org_id', agent.org_id)
      .eq('type', 'instagram')
      .maybeSingle();

    const credentials = (channel?.credentials as Record<string, unknown> | null) ?? {};
    const dbStatus = normalizeConnectionStatus((channel?.connection_status as InstagramStatus | null) ?? (channel?.is_active ? 'connected' : 'disconnected'));
    return {
      status: dbStatus,
      username: typeof credentials.username === 'string' ? credentials.username : undefined,
    };
  } catch (error) {
    logger.warn({ agentId, error }, 'Failed to load Instagram status from database');
    return { status: 'disconnected' };
  }
}

export async function disconnectInstagram(agentId: string): Promise<InstagramClientInfo> {
  const existing = clientStore.get(agentId);
  if (existing) {
    try {
      await existing.client.realtime.disconnect();
    } catch (error) {
      logger.warn({ agentId, error }, 'Failed to disconnect Instagram realtime client gracefully');
    }
    clientStore.delete(agentId);
    clientInitLocks.delete(agentId);
  }

  try {
    const admin = createAdminClient();
    const { data: agent } = await admin.from('agents').select('org_id').eq('id', agentId).single();
    if (agent?.org_id) {
      const { data: channel } = await admin
        .from('channels')
        .select('id, credentials')
        .eq('org_id', agent.org_id)
        .eq('type', 'instagram')
        .maybeSingle();

      await admin
        .from('channels')
        .update({
          is_active: false,
          connection_status: 'disconnected',
          credentials: {
            ...(channel?.credentials as Record<string, unknown> | null),
            agent_id: agentId,
            username: (channel?.credentials as Record<string, unknown> | null)?.username ?? null,
            state: null,
            password: undefined,
          },
        })
        .eq('id', channel?.id ?? '');
    }
  } catch (error) {
    logger.warn({ agentId, error }, 'Failed to clear Instagram state after disconnect');
  }

  await syncInstagramChannelState(agentId, 'disconnected', false);
  return { status: 'disconnected' };
}

function scheduledReconnect(agentId: string, entry: InstagramClientEntry, reason: string) {
  if (entry.reconnectTimer) {
    clearTimeout(entry.reconnectTimer);
  }

  const delay = Math.min(30_000, 2000 * (2 ** Math.min(entry.reconnectAttempts, 4)));
  entry.reconnectAttempts += 1;
  entry.lastReconnectAt = Date.now();
  entry.reconnectTimer = setTimeout(async () => {
    try {
      await restoreFromState(agentId);
    } catch (error) {
      logger.warn({ agentId, reason, error }, 'Instagram reconnect attempt failed');
    }
  }, delay);
}

async function attachRealtimeHandlers(agentId: string, ig: IgApiClientRealtime, username?: string) {
  ig.realtime.on('close', () => {
    const current = clientStore.get(agentId);
    if (!current) return;
    current.status = 'disconnected';
    void syncInstagramChannelState(agentId, 'disconnected', false);
    scheduledReconnect(agentId, current, 'instagram_realtime_close');
  });

  ig.realtime.on('error', (error: Error) => {
    const current = clientStore.get(agentId);
    if (!current) return;
    current.status = 'error';
    current.lastError = error instanceof Error ? error.message : 'Ошибка соединения Instagram';
    void syncInstagramChannelState(agentId, 'error', false);
    scheduledReconnect(agentId, current, 'instagram_realtime_error');
  });

  ig.realtime.on('message', async (payload: any) => {
    const message = payload?.message ?? payload;
    if (!message || !message.thread_id || !message.item_id) return;
    if (String(message.user_id) === String(ig.state.cookieUserId)) return;

    try {
      await handleIncomingMessageWithDependencies(
        agentId,
        ig,
        message,
        {
          createAdminClient,
          ensureInstagramChannel,
          runAgentTurnWithLead,
          logger,
          getSenderInfo: async (userId: string | number) => {
            try {
              const userRepo = (ig as any)?.user;
              if (!userRepo || typeof userRepo.getInfo !== 'function') {
                return null;
              }
              const user = await userRepo.getInfo(userId as any);
              return user ?? null;
            } catch {
              return null;
            }
          },
          sendText: async (currentAgentId: string, threadId: string, text: string) => {
            await sendInstagramText(currentAgentId, threadId, text);
          },
        }
      );
    } catch (error) {
      logger.error({ agentId, error }, 'Failed to process incoming Instagram message');
    }
  });

  try {
    const snapshot = await ig.feed.directInbox().request();
    await ig.realtime.connect({ irisData: snapshot });
    await ig.realtime.direct?.sendForegroundState({
      inForegroundApp: true,
      inForegroundDevice: true,
      keepAliveTimeout: 60,
      subscribeTopics: [],
      subscribeGenericTopics: [],
      unsubscribeTopics: [],
      unsubscribeGenericTopics: [],
      requestId: BigInt(Date.now()),
    });
    const current = clientStore.get(agentId);
    if (current) {
      current.status = 'connected';
      current.username = username ?? current.username;
      current.lastError = undefined;
      current.reconnectAttempts = 0;
      current.challengeType = undefined;
      await syncInstagramChannelState(agentId, 'connected', true);
      await storeInstagramSession(agentId, username ?? current.username, ig);
    }
  } catch (error) {
    logger.warn({ agentId, error }, 'Instagram realtime connection failed');
    const current = clientStore.get(agentId);
    if (current) {
      current.status = 'error';
      current.lastError = error instanceof Error ? error.message : 'Ошибка подключения Instagram';
      await syncInstagramChannelState(agentId, 'error', false);
    }
    throw error;
  }
}

export async function restoreFromState(agentId: string) {
  const existing = clientStore.get(agentId);
  if (existing) {
    return existing;
  }

  const admin = createAdminClient();
  const { data: agent } = await admin.from('agents').select('org_id').eq('id', agentId).single();
  if (!agent?.org_id) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  const { data: channel } = await admin
    .from('channels')
    .select('id, credentials, connection_status')
    .eq('org_id', agent.org_id)
    .eq('type', 'instagram')
    .maybeSingle();

  if (!channel?.credentials || typeof (channel.credentials as Record<string, unknown>)?.state !== 'string') {
    return null;
  }

  const creds = channel.credentials as Record<string, unknown>;
  const username = typeof creds.username === 'string' ? creds.username : undefined;
  const client = withRealtime(new IgApiClient()) as IgApiClientRealtime;
  client.state.generateDevice(username ?? `agent-${agentId}`);
  await client.importState(String(creds.state));

  const entry: InstagramClientEntry = {
    client,
    status: 'disconnected',
    reconnectAttempts: 0,
    username,
  };

  clientStore.set(agentId, entry);

  try {
    await client.account.currentUser();
    await attachRealtimeHandlers(agentId, client, username);
    entry.status = 'connected';
    entry.lastError = undefined;
    return entry;
  } catch (error) {
    if (error instanceof Error && error.name === 'IgCheckpointError') {
      entry.status = 'challenge';
      entry.challengeType = 'challenge';
      entry.lastError = 'Instagram запросил проверку безопасности';
      await syncInstagramChannelState(agentId, 'challenge', false);
      return entry;
    }
    if (error instanceof Error && error.name === 'IgLoginTwoFactorRequiredError') {
      entry.status = '2fa';
      entry.challengeType = '2fa';
      entry.lastError = 'Instagram требует двухфакторную проверку';
      await syncInstagramChannelState(agentId, '2fa', false);
      return entry;
    }
    entry.status = 'error';
    entry.lastError = error instanceof Error ? error.message : 'Ошибка восстановления Instagram';
    await syncInstagramChannelState(agentId, 'error', false);
    throw error;
  }
}

export async function loginInstagram(agentId: string, username: string, password: string): Promise<InstagramClientInfo> {
  const existing = clientStore.get(agentId);
  if (existing) {
    return { status: existing.status, lastError: existing.lastError, username: existing.username, challengeType: existing.challengeType };
  }

  try {
    const client = withRealtime(new IgApiClient()) as IgApiClientRealtime;
    const proxyUrl = process.env.IG_PROXY?.trim();
    if (proxyUrl) {
      client.state.proxyUrl = proxyUrl;
    }
    client.state.generateDevice(username);
    await client.account.login(username, password);

    const entry: InstagramClientEntry = {
      client,
      status: 'connected',
      reconnectAttempts: 0,
      username,
    };

    clientStore.set(agentId, entry);
    await attachRealtimeHandlers(agentId, client, username);
    await syncInstagramChannelState(agentId, 'connected', true);
    return { status: 'connected', username };
  } catch (error) {
    if ((error as any)?.constructor?.name === 'IgLoginTwoFactorRequiredError' || error instanceof Error && error.name === 'IgLoginTwoFactorRequiredError') {
      const client = withRealtime(new IgApiClient()) as IgApiClientRealtime;
      const proxyUrl = process.env.IG_PROXY?.trim();
      if (proxyUrl) {
        client.state.proxyUrl = proxyUrl;
      }
      client.state.generateDevice(username);
      const entry: InstagramClientEntry = { client, status: '2fa', reconnectAttempts: 0, username, challengeType: '2fa' };
      clientStore.set(agentId, entry);
      await syncInstagramChannelState(agentId, '2fa', false);
      return { status: '2fa', username, challengeType: '2fa' };
    }

    if ((error as any)?.constructor?.name === 'IgCheckpointError' || error instanceof Error && error.name === 'IgCheckpointError') {
      const client = withRealtime(new IgApiClient()) as IgApiClientRealtime;
      const proxyUrl = process.env.IG_PROXY?.trim();
      if (proxyUrl) {
        client.state.proxyUrl = proxyUrl;
      }
      client.state.generateDevice(username);
      const entry: InstagramClientEntry = { client, status: 'challenge', reconnectAttempts: 0, username, challengeType: 'challenge' };
      clientStore.set(agentId, entry);
      await syncInstagramChannelState(agentId, 'challenge', false);
      return { status: 'challenge', username, challengeType: 'challenge' };
    }

    const info: InstagramClientInfo = {
      status: 'error',
      lastError: getInstagramFriendlyError(error, 'Не удалось войти в Instagram'),
      username,
    };
    await syncInstagramChannelState(agentId, 'error', false);
    return info;
  }
}

export async function submitInstagramCode(agentId: string, code: string): Promise<InstagramClientInfo> {
  const entry = clientStore.get(agentId);
  if (!entry || !entry.client) {
    return { status: 'disconnected', lastError: 'Сессия Instagram не найдена' };
  }

  try {
    const client = entry.client;
    const username = entry.username ?? '';
    const challengeInfo = (client.state as any).challenge as Record<string, any> | undefined;
    const twoFactorIdentifiers = challengeInfo?.two_factor_info?.two_factor_identifier ?? challengeInfo?.two_factor_identifier;

    await client.account.twoFactorLogin({
      username,
      verificationCode: code,
      twoFactorIdentifier: twoFactorIdentifiers,
      trustThisDevice: '1',
      verificationMethod: '1',
    });

    entry.status = 'connected';
    entry.challengeType = undefined;
    entry.lastError = undefined;
    await attachRealtimeHandlers(agentId, client, username);
    await syncInstagramChannelState(agentId, 'connected', true);
    return { status: 'connected', username };
  } catch (error) {
    entry.status = 'error';
    entry.lastError = getInstagramFriendlyError(error, 'Ошибка подтверждения кода Instagram');
    await syncInstagramChannelState(agentId, 'error', false);
    return { status: 'error', lastError: entry.lastError, username: entry.username };
  }
}

export async function sendInstagramText(agentId: string, threadId: string, text: string) {
  const entry = clientStore.get(agentId);
  if (!entry?.client) {
    throw new Error('Instagram client is not initialized');
  }
  if (entry.status !== 'connected') {
    throw new Error('Instagram is not connected');
  }
  await entry.client.entity.directThread(threadId).broadcastText(text);
}

export async function restoreAllInstagramSessions() {
  await resetStaleInstagramStatuses();
  try {
    const admin = createAdminClient();
    const { data: channels } = await admin
      .from('channels')
      .select('credentials, org_id')
      .eq('type', 'instagram');

    const channelList = channels ?? [];
    logger.info({ count: channelList.length }, 'Restoring persisted Instagram sessions on cold start');

    for (const channel of channelList) {
      const credentials = (channel.credentials as Record<string, unknown> | null) ?? {};
      const agentId = typeof credentials.agent_id === 'string' ? credentials.agent_id : null;
      const state = typeof credentials.state === 'string' ? credentials.state : null;
      if (!agentId || !state) continue;
      try {
        await restoreFromState(agentId);
      } catch (error) {
        logger.warn({ agentId, error }, 'Failed to restore persisted Instagram session');
      }
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to scan Instagram channels for cold-start rebuild');
  }
}

void restoreAllInstagramSessions();
