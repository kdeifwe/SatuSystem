import test from 'node:test';
import assert from 'node:assert/strict';
import { isSandboxToolAllowed } from '../lib/ai/tools/sandbox-allowlist.ts';

test('createKaspiInvoice is allowed in sandbox', () => {
  assert.equal(isSandboxToolAllowed('createKaspiInvoice'), true);
});
