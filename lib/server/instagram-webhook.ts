import { createHmac, timingSafeEqual } from 'node:crypto';
import pino from 'pino';

const logger = pino({ level: process.env.NODE_ENV === 'development' ? 'info' : 'warn' });

export function verifyInstagramWebhookSignature(rawBody: string, signature: string | null | undefined, secret: string | null | undefined) {
  const hasSignature = Boolean(signature);
  const hasSecret = Boolean(secret);

  if (!signature || !secret) {
    logger.warn({ hasSignature, hasSecret, valid: false }, 'Instagram webhook signature missing');
    return false;
  }

  const expectedSignature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

  try {
    const providedBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    if (providedBuffer.length !== expectedBuffer.length) {
      logger.warn({ hasSignature, hasSecret, valid: false }, 'Instagram webhook signature invalid length');
      return false;
    }

    const valid = timingSafeEqual(providedBuffer, expectedBuffer);
    logger.info({ hasSignature, hasSecret, valid }, 'Instagram webhook signature check');
    return valid;
  } catch (error) {
    logger.warn({ hasSignature, hasSecret, valid: false, errorMessage: error instanceof Error ? error.message : 'unknown' }, 'Instagram webhook signature check failed');
    return false;
  }
}

export function extractInstagramWebhookMessages(payload: any) {
  const messages = payload?.entry ?? [];
  const results: Array<{ senderId: string; recipientId: string; mid: string; text: string }> = [];

  let entryCount = 0;
  let messagingCount = 0;

  for (const entry of messages) {
    entryCount += 1;
    const entryMessaging = Array.isArray(entry?.messaging) ? entry.messaging : [];
    messagingCount += entryMessaging.length;

    for (const item of entryMessaging) {
      const senderId = typeof item?.sender?.id === 'string' ? item.sender.id : '';
      const recipientId = typeof item?.recipient?.id === 'string' ? item.recipient.id : '';
      const mid = typeof item?.message?.mid === 'string' ? item.message.mid : '';
      const text = typeof item?.message?.text === 'string' ? item.message.text.trim() : '';
      const isEcho = Boolean(item?.message?.is_echo);
      const textLength = text.length;

      logger.info({ senderId, recipientId, isEcho, textLength, messageId: mid || null }, 'Instagram webhook message candidate');

      if (!senderId || !recipientId || !mid || isEcho || !text) continue;
      results.push({ senderId, recipientId, mid, text });
    }
  }

  logger.info({ entryCount, messagingCount, extractedCount: results.length }, 'Instagram webhook messages extracted');
  return results;
}

export function getInstagramExternalMessageId(mid: string) {
  return `ig_${mid}`;
}

export async function resolveInstagramChannelByRecipientId(admin: any, recipientId: string) {
  if (!recipientId) return null;

  const { data, error } = await admin
    .from('channels')
    .select('id, org_id, credentials, is_active, connection_status')
    .eq('type', 'instagram')
    .eq('is_active', true)
    .eq('credentials->>ig_user_id', recipientId)
    .maybeSingle();

  if (error) {
    logger.warn({ recipientId, errorMessage: error.message }, 'Instagram channel lookup failed');
    return null;
  }

  logger.info({ recipientId, found: Boolean(data) }, 'Instagram channel lookup result');
  return data;
}
