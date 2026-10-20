import pino from 'pino';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Тонкий клиент к службе ig-worker (services/ig-worker).
 * Вся работа с Instagram (вход, сессия, опрос директа, отправка) живёт в воркере.
 * Здесь только HTTP-вызовы и поиск канала в БД. Пароли нигде не логируются и не сохраняются.
 */

const logger = pino({ level: process.env.NODE_ENV === 'development' ? 'info' : 'warn' });

export type InstagramStatus = 'connected' | 'disconnected' | 'connecting' | 'challenge' | '2fa' | 'error';

export interface InstagramClientInfo {
  status: InstagramStatus;
  lastError?: string;
  username?: string;
  challengeType?: 'challenge' | '2fa';
}

export class InstagramWorkerError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'InstagramWorkerError';
  }
}

interface WorkerStatusResponse {
  status?: string;
  username?: string | null;
  last_error?: string | null;
  challenge_type?: string | null;
}

const KNOWN_STATUSES: InstagramStatus[] = ['connected', 'disconnected', 'connecting', 'challenge', '2fa', 'error'];

function normalizeStatus(value: unknown): InstagramStatus {
  return KNOWN_STATUSES.includes(value as InstagramStatus) ? (value as InstagramStatus) : 'disconnected';
}

function toClientInfo(data: WorkerStatusResponse): InstagramClientInfo {
  const status = normalizeStatus(data.status);
  return {
    status,
    username: data.username ?? undefined,
    lastError: data.last_error ?? undefined,
    challengeType: status === 'challenge' || status === '2fa' ? status : undefined,
  };
}

async function workerFetch<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const base = process.env.IG_WORKER_URL?.trim().replace(/\/+$/, '');
  const secret = process.env.IG_WORKER_SECRET?.trim();
  if (!base || !secret) {
    throw new InstagramWorkerError('Служба Instagram не настроена (IG_WORKER_URL / IG_WORKER_SECRET).', 503, 'not_configured');
  }

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
      cache: 'no-store',
    });
  } catch (error) {
    logger.warn({ path, errorName: error instanceof Error ? error.name : 'unknown' }, 'ig-worker unreachable');
    throw new InstagramWorkerError('Служба Instagram недоступна. Попробуйте позже.', 503, 'worker_unreachable');
  }

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : `Ошибка службы Instagram (${response.status})`;
    const code = typeof payload.code === 'string' ? payload.code : 'worker_error';
    throw new InstagramWorkerError(message, response.status, code);
  }
  return payload as T;
}

// ---------------------------------------------------------------- channels

export interface InstagramChannelRow {
  id: string;
  org_id: string;
  credentials: Record<string, unknown> | null;
  is_active: boolean | null;
  connection_status: string | null;
}

async function getOrgId(agentId: string): Promise<string> {
  const admin = createAdminClient();
  const { data: agent, error } = await admin.from('agents').select('org_id').eq('id', agentId).single();
  if (error || !agent?.org_id) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  return agent.org_id as string;
}

export async function findInstagramChannel(agentId: string): Promise<InstagramChannelRow | null> {
  const admin = createAdminClient();
  const orgId = await getOrgId(agentId);
  const { data } = await admin
    .from('channels')
    .select('id, org_id, credentials, is_active, connection_status')
    .eq('org_id', orgId)
    .eq('type', 'instagram')
    .maybeSingle();
  return (data as InstagramChannelRow | null) ?? null;
}

/** Создаёт (или перевязывает) канал Instagram для режима «логин/пароль». OAuth-токены при этом сбрасываются. */
export async function ensureInstagramUserbotChannel(agentId: string, username: string): Promise<InstagramChannelRow> {
  const admin = createAdminClient();
  const orgId = await getOrgId(agentId);
  const existing = await findInstagramChannel(agentId);

  const previous = (existing?.credentials ?? {}) as Record<string, unknown>;
  const sameAccount = previous.provider === 'userbot' && previous.username === username;
  const credentials: Record<string, unknown> = {
    agent_id: agentId,
    provider: 'userbot',
    username,
    // сохранённая сессия остаётся только если это тот же аккаунт; воркер всё равно перезапишет её при входе
    ...(sameAccount && typeof previous.session === 'string' ? { session: previous.session } : {}),
  };

  if (existing) {
    const { error } = await admin
      .from('channels')
      .update({ credentials, is_active: false, connection_status: 'disconnected' })
      .eq('id', existing.id);
    if (error) throw new Error(`Failed to update Instagram channel: ${error.message}`);
    return { ...existing, credentials, is_active: false, connection_status: 'disconnected' };
  }

  const { data, error } = await admin
    .from('channels')
    .insert({ org_id: orgId, type: 'instagram', credentials, is_active: false, connection_status: 'disconnected' })
    .select('id, org_id, credentials, is_active, connection_status')
    .single();
  if (error || !data) throw new Error(`Failed to create Instagram channel: ${error?.message}`);
  return data as InstagramChannelRow;
}

// ---------------------------------------------------------------- public API

export async function loginInstagram(agentId: string, username: string, password: string): Promise<InstagramClientInfo> {
  const cleanUsername = username.trim().replace(/^@+/, '');
  const channel = await ensureInstagramUserbotChannel(agentId, cleanUsername);
  const data = await workerFetch<WorkerStatusResponse>('/login', {
    method: 'POST',
    body: { channel_id: channel.id, username: cleanUsername, password },
    timeoutMs: 135_000,
  });
  return toClientInfo(data);
}

export async function submitInstagramCode(agentId: string, code: string): Promise<InstagramClientInfo> {
  const channel = await findInstagramChannel(agentId);
  if (!channel) return { status: 'disconnected', lastError: 'Сначала выполните вход в Instagram' };
  try {
    const data = await workerFetch<WorkerStatusResponse>('/verify', {
      method: 'POST',
      body: { channel_id: channel.id, code },
      timeoutMs: 135_000,
    });
    return toClientInfo(data);
  } catch (error) {
    if (error instanceof InstagramWorkerError && error.httpStatus < 500) {
      return { status: 'error', lastError: error.message };
    }
    throw error;
  }
}

export async function getInstagramStatus(agentId: string): Promise<InstagramClientInfo> {
  let channel: InstagramChannelRow | null = null;
  try {
    channel = await findInstagramChannel(agentId);
  } catch (error) {
    logger.warn({ agentId, errorName: error instanceof Error ? error.name : 'unknown' }, 'Instagram channel lookup failed');
    return { status: 'disconnected' };
  }
  if (!channel) return { status: 'disconnected' };

  const credentials = (channel.credentials ?? {}) as Record<string, unknown>;
  if (credentials.provider !== 'userbot') {
    // старое OAuth-подключение: в этом режиме не используется
    return { status: 'disconnected', lastError: 'Требуется подключение по логину и паролю' };
  }

  try {
    const data = await workerFetch<WorkerStatusResponse>(`/status/${encodeURIComponent(channel.id)}`);
    return toClientInfo(data);
  } catch (error) {
    // воркер недоступен: показываем то, что записано в БД, и честно говорим о проблеме
    return {
      status: normalizeStatus(channel.connection_status) === 'connected' ? 'error' : normalizeStatus(channel.connection_status),
      username: typeof credentials.username === 'string' ? credentials.username : undefined,
      lastError: error instanceof Error ? error.message : 'Служба Instagram недоступна',
    };
  }
}

export async function disconnectInstagram(agentId: string): Promise<InstagramClientInfo> {
  const channel = await findInstagramChannel(agentId);
  if (!channel) return { status: 'disconnected' };
  try {
    await workerFetch<WorkerStatusResponse>(`/logout/${encodeURIComponent(channel.id)}`, { method: 'POST', timeoutMs: 40_000 });
  } catch (error) {
    // воркер недоступен — всё равно гасим канал в БД, чтобы он не считался активным
    logger.warn({ agentId, errorName: error instanceof Error ? error.name : 'unknown' }, 'ig-worker logout failed, clearing channel locally');
    const admin = createAdminClient();
    const credentials = { ...((channel.credentials ?? {}) as Record<string, unknown>) };
    delete credentials.session;
    delete credentials.last_error;
    await admin.from('channels').update({ credentials, is_active: false, connection_status: 'disconnected' }).eq('id', channel.id);
  }
  return { status: 'disconnected' };
}

/** Отправка текста в Instagram-тред (thread_id хранится в leads.external_id). */
export async function sendInstagramText(agentId: string, threadId: string, text: string): Promise<void> {
  const channel = await findInstagramChannel(agentId);
  if (!channel) throw new Error('Instagram channel is not connected');
  await workerFetch<{ ok: boolean }>('/send', {
    method: 'POST',
    body: { channel_id: channel.id, thread_id: threadId, text },
    timeoutMs: 30_000,
  });
}
