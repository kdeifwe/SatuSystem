import assert from 'node:assert/strict';
import { buildFunnelStepInstruction, runAgentTurn } from '../lib/server/ai/orchestrator';

assert.equal(typeof buildFunnelStepInstruction, 'function');
assert.match(buildFunnelStepInstruction('step-2'), /step-2/);
assert.equal(typeof runAgentTurn, 'function');

console.log('orchestrator canonical path ok');
