import test from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultConfig } from '../lib/telegram-extension-config.ts';

test('getDefaultConfig fills missing event values', () => {
  const config = getDefaultConfig({});

  assert.deepEqual(config.recipients, []);
  assert.equal(config.events.operator_needed.enabled, true);
  assert.equal(config.events.ai_silent.enabled, true);
  assert.equal(config.events.ai_silent.threshold_minutes, 5);
  assert.equal(config.events.deal_lost.enabled, false);
  assert.deepEqual(config.events.custom_conditions, []);
});

test('getDefaultConfig merges saved values without dropping defaults', () => {
  const config = getDefaultConfig({
    events: {
      operator_needed: { enabled: false },
      ai_silent: { threshold_minutes: 10 },
    },
  });

  assert.equal(config.events.operator_needed.enabled, false);
  assert.equal(config.events.ai_silent.enabled, true);
  assert.equal(config.events.ai_silent.threshold_minutes, 10);
  assert.equal(config.events.deal_won.enabled, true);
});
