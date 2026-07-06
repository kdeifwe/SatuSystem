require('ts-node/register/transpile-only');

const test = require('node:test');
const assert = require('node:assert/strict');
const { isSandboxToolAllowed } = require('../lib/ai/tools/sandbox-allowlist');

test('advanceFunnelStep remains available in sandbox mode', () => {
  assert.equal(isSandboxToolAllowed('advanceFunnelStep'), true);
  assert.equal(isSandboxToolAllowed('searchKnowledgeBase'), true);
  assert.equal(isSandboxToolAllowed('redirectToOperator'), false);
});
