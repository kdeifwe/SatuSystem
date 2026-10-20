import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_SKEW_SECONDS = 5 * 60;

/**
 * Проверка подписи входящего запроса от ig-worker.
 * Подпись: sha256=hex(HMAC(secret, "<timestamp>.<rawBody>")), timestamp в секундах (заголовок x-ig-timestamp).
 */
export function verifyInstagramInboundSignature(params: {
  rawBody: string;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  secret: string | null | undefined;
  nowSeconds?: number;
}): boolean {
  const { rawBody, signature, timestamp, secret } = params;
  if (!signature || !timestamp || !secret) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_SKEW_SECONDS) return false;

  const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
  const provided = Buffer.from(signature, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  if (provided.length !== wanted.length) return false;
  return timingSafeEqual(provided, wanted);
}
