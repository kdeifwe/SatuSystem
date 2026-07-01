const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeConnectionStatus, buildChannelStatusUpdate } = require('../lib/channels/status-utils');

test('normalizeConnectionStatus keeps the supported Baileys values', () => {
  assert.equal(normalizeConnectionStatus('qr'), 'qr');
  assert.equal(normalizeConnectionStatus('connected'), 'connected');
  assert.equal(normalizeConnectionStatus('disconnected'), 'disconnected');
  assert.equal(normalizeConnectionStatus('error'), 'error');
});

test('normalizeConnectionStatus falls back to disconnected for unsupported values', () => {
  assert.equal(normalizeConnectionStatus('unknown'), 'disconnected');
  assert.equal(normalizeConnectionStatus(undefined), 'disconnected');
});

test('buildChannelStatusUpdate writes both DB fields consistently', () => {
  const payload = buildChannelStatusUpdate('connected', true);
  assert.deepEqual(payload, { is_active: true, connection_status: 'connected' });
});
