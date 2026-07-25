import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyKaspiWebhookSignature(rawBody: string, signature: string | null | undefined, secret: string | null | undefined) {
  if (!signature || !secret) {
    return false;
  }

  const expectedSignature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

  try {
    const providedBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

    if (providedBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(providedBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

export function getKaspiWebhookStatusUpdate(event: string | null | undefined) {
  switch (event) {
    case 'payment.success':
      return { status: 'paid', paidAt: true };
    case 'payment.failed':
      return { status: 'failed', paidAt: false };
    case 'payment.expired':
      return { status: 'expired', paidAt: false };
    default:
      return null;
  }
}
