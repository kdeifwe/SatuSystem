import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTelegramExternalMessageId,
  buildTelegramAiExternalMessageId,
} from '../lib/server/telegram-message-ids.ts';

test('Telegram inbound ids are unique per channel and repeat updates still dedupe', () => {
  const seenExternalIds = new Set<string>();

  const saveIncoming = (channelId: string, messageId: number) => {
    const externalMessageId = buildTelegramExternalMessageId(channelId, messageId);
    if (seenExternalIds.has(externalMessageId)) {
      return false;
    }
    seenExternalIds.add(externalMessageId);
    return true;
  };

  assert.equal(saveIncoming('channel-1', 13), true);
  assert.equal(saveIncoming('channel-2', 13), true);
  assert.equal(saveIncoming('channel-1', 13), false);

  assert.equal(buildTelegramExternalMessageId('channel-1', 13), 'tg_channel-1_13');
  assert.equal(buildTelegramExternalMessageId('channel-2', 13), 'tg_channel-2_13');
  assert.notEqual(buildTelegramExternalMessageId('channel-1', 13), buildTelegramExternalMessageId('channel-2', 13));
});

test('Telegram AI reply ids remain unique per channel and message part', () => {
  const first = buildTelegramAiExternalMessageId('channel-1', 13, 0);
  const second = buildTelegramAiExternalMessageId('channel-2', 13, 0);
  const repeat = buildTelegramAiExternalMessageId('channel-1', 13, 0);

  assert.equal(first, 'tg_ai_channel-1_13_0');
  assert.equal(second, 'tg_ai_channel-2_13_0');
  assert.notEqual(first, second);
  assert.equal(first, repeat);
});
