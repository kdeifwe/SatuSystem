import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeKaspiPhone } from '../lib/kaspi-phone.ts';

test('normalizes 8XXXXXXXXXX to 7XXXXXXXXXX', () => {
  const normalizedFrom8 = normalizeKaspiPhone('87713269983');
  const normalizedFrom7 = normalizeKaspiPhone('77713269983');

  assert.equal(normalizedFrom8, '77713269983');
  assert.equal(normalizedFrom7, '77713269983');
  assert.equal(normalizedFrom8, normalizedFrom7);
});
