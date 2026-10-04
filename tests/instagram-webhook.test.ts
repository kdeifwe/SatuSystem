import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  verifyInstagramWebhookSignature,
  extractInstagramWebhookMessages,
  getInstagramExternalMessageId,
  resolveInstagramChannelByRecipientId,
} from '../lib/server/instagram-webhook';

test('verifyInstagramWebhookSignature validates raw body using HMAC SHA256', () => {
  const secret = 'instagram-secret';
  const rawBody = JSON.stringify({ entry: [{ messaging: [{ message: { mid: 'mid_1', text: 'hi' } }] }] });
  const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

  assert.equal(verifyInstagramWebhookSignature(rawBody, signature, secret), true);
  assert.equal(verifyInstagramWebhookSignature(rawBody, 'sha256=wrong', secret), false);
});

test('extractInstagramWebhookMessages ignores echo and empty text', () => {
  const payload = {
    entry: [
      {
        messaging: [
          { sender: { id: 'user_1' }, recipient: { id: 'page_42' }, message: { mid: 'mid_1', text: 'hello', is_echo: true } },
          { sender: { id: 'user_1' }, recipient: { id: 'page_42' }, message: { mid: 'mid_2', text: 'hello world' } },
          { sender: { id: 'user_1' }, recipient: { id: 'page_42' }, message: { mid: 'mid_3', text: '' } },
        ],
      },
    ],
  };

  const messages = extractInstagramWebhookMessages(payload);
  assert.deepEqual(messages.map((message) => message.mid), ['mid_2']);
});

test('deduplicates repeated Instagram messages by mid', () => {
  const first = getInstagramExternalMessageId('mid_123');
  const second = getInstagramExternalMessageId('mid_123');

  assert.equal(first, 'ig_mid_123');
  assert.equal(second, 'ig_mid_123');
});

test('resolveInstagramChannelByRecipientId selects channel by credentials ig_user_id', async () => {
  const channel = await resolveInstagramChannelByRecipientId({
    from(table: string) {
      const builder = {
        select() { return builder; },
        eq(key: string, value: unknown) { return builder; },
        maybeSingle() {
          return Promise.resolve({ data: { id: 'channel_1', org_id: 'org_1', credentials: { ig_user_id: 'page_42' } }, error: null });
        },
      };
      return builder;
    },
  } as any, 'page_42');

  assert.equal(channel?.id, 'channel_1');
  assert.deepEqual(channel?.credentials, { ig_user_id: 'page_42' });
});
