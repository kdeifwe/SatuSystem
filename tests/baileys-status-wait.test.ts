import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForBaileysStatus } from '../lib/channels/baileys-status-wait';

test('waitForBaileysStatus resolves when the target status appears', async () => {
  let status: string | undefined = 'disconnected';

  const result = waitForBaileysStatus(() => status, ['qr'], 50, 5);

  setTimeout(() => {
    status = 'qr';
  }, 20);

  assert.equal(await result, 'qr');
});

test('waitForBaileysStatus returns the latest status after timeout', async () => {
  let status: string | undefined = 'disconnected';

  const result = waitForBaileysStatus(() => status, ['connected'], 30, 10);

  assert.equal(await result, 'disconnected');
});
