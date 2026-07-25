import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { getKaspiWebhookStatusUpdate, verifyKaspiWebhookSignature } from '../lib/server/kaspi-webhook.ts';

test('verifyKaspiWebhookSignature accepts a matching signature', () => {
  const secret = 'test-secret';
  const rawBody = JSON.stringify({ event: 'payment.success', paymentId: 'abc' });
  const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

  assert.equal(verifyKaspiWebhookSignature(rawBody, signature, secret), true);
});

test('verifyKaspiWebhookSignature rejects a mismatched signature', () => {
  const secret = 'test-secret';
  const rawBody = JSON.stringify({ event: 'payment.success', paymentId: 'abc' });
  const signature = 'sha256=deadbeef';

  assert.equal(verifyKaspiWebhookSignature(rawBody, signature, secret), false);
});

test('getKaspiWebhookStatusUpdate maps supported events', () => {
  assert.deepEqual(getKaspiWebhookStatusUpdate('payment.success'), { status: 'paid', paidAt: true });
  assert.deepEqual(getKaspiWebhookStatusUpdate('payment.failed'), { status: 'failed', paidAt: false });
  assert.deepEqual(getKaspiWebhookStatusUpdate('payment.expired'), { status: 'expired', paidAt: false });
});
