import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTelegramNotificationsWebhookUrl, parseTelegramNotificationCommand } from '../lib/extensions/telegram-notify.ts';

test('buildTelegramNotificationsWebhookUrl uses provided app URL', () => {
  assert.equal(
    buildTelegramNotificationsWebhookUrl('https://example.com/'),
    'https://example.com/api/extensions/telegram-notify/webhook'
  );
});

test('parseTelegramNotificationCommand detects start commands with token', () => {
  assert.deepEqual(parseTelegramNotificationCommand('/start 123'), { kind: 'start', token: '123' });
});

test('parseTelegramNotificationCommand handles plain /start', () => {
  assert.deepEqual(parseTelegramNotificationCommand('/start'), { kind: 'start' });
});
