import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyInstagramWebhookSignature(rawBody: string, signature: string | null | undefined, secret: string | null | undefined) {
  if (!signature || !secret) return false;
  const expectedSignature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

  try {
    const providedBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    if (providedBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(providedBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

export function extractInstagramWebhookMessages(payload: any) {
  const messages = payload?.entry ?? [];
  const results: Array<{ senderId: string; recipientId: string; mid: string; text: string }> = [];

  for (const entry of messages) {
    for (const item of entry?.messaging ?? []) {
      const senderId = typeof item?.sender?.id === 'string' ? item.sender.id : '';
      const recipientId = typeof item?.recipient?.id === 'string' ? item.recipient.id : '';
      const mid = typeof item?.message?.mid === 'string' ? item.message.mid : '';
      const text = typeof item?.message?.text === 'string' ? item.message.text.trim() : '';
      const isEcho = Boolean(item?.message?.is_echo);

      if (!senderId || !recipientId || !mid || isEcho || !text) continue;
      results.push({ senderId, recipientId, mid, text });
    }
  }

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
    return null;
  }

  return data;
}
