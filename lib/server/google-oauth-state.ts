import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const STATE_TTL_MS = 10 * 60 * 1000;

export function buildGoogleOAuthState(agentId: string, userId: string, secret: string) {
  const timestamp = Date.now();
  const nonce = randomBytes(16).toString('hex');
  const payload = `${agentId}|${userId}|${timestamp}|${nonce}`;
  const hmac = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}|${hmac}`;
}

export function verifyGoogleOAuthState(state: string | null | undefined, agentId: string, userId: string, secret: string): boolean {
  if (!state) return false;

  const parts = state.split('|');
  if (parts.length !== 5) return false;

  const [stateAgentId, stateUserId, timestampRaw, nonce, signature] = parts;
  if (!stateAgentId || !stateUserId || !timestampRaw || !nonce || !signature) return false;
  if (stateAgentId !== agentId || stateUserId !== userId) return false;

  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) return false;
  if (Date.now() - timestamp > STATE_TTL_MS) return false;

  const expectedPayload = `${stateAgentId}|${stateUserId}|${timestampRaw}|${nonce}`;
  const expected = createHmac('sha256', secret).update(expectedPayload).digest('hex');

  const providedBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) return false;

  try {
    return timingSafeEqual(providedBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

export function parseGoogleOAuthState(state: string | null | undefined) {
  if (!state) return null;
  const parts = state.split('|');
  if (parts.length !== 5) return null;
  const [agentId, userId, timestamp, nonce, signature] = parts;
  return { agentId, userId, timestamp: Number(timestamp), nonce, signature };
}
