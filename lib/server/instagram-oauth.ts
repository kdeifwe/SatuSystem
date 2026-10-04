import { createHmac, timingSafeEqual } from 'node:crypto';

export function buildInstagramOAuthState(agentId: string, userId: string, secret: string) {
  const timestamp = Date.now();
  const payload = `${agentId}|${userId}|${timestamp}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}|${signature}`;
}

export function verifyInstagramOAuthState(state: string | null | undefined, agentId: string, userId: string, secret: string) {
  if (!state) return false;

  const parts = state.split('|');
  if (parts.length !== 4) return false;

  const [stateAgentId, stateUserId, timestamp, signature] = parts;
  if (!stateAgentId || !stateUserId || !timestamp || !signature) return false;
  if (stateAgentId !== agentId || stateUserId !== userId) return false;

  const expected = createHmac('sha256', secret).update(`${stateAgentId}|${stateUserId}|${timestamp}`).digest('hex');
  const providedBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (providedBuffer.length !== expectedBuffer.length) return false;

  try {
    return timingSafeEqual(providedBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

export function parseInstagramOAuthState(state: string | null | undefined) {
  if (!state) return null;
  const parts = state.split('|');
  if (parts.length !== 4) return null;
  const [agentId, userId, timestamp, signature] = parts;
  return { agentId, userId, timestamp: Number(timestamp), signature };
}
