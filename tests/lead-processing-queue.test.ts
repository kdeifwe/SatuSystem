import test from 'node:test';
import assert from 'node:assert/strict';
import { withLeadProcessingLock } from '../lib/server/lead-processing-queue';
import { resolveLeadContextMode } from '../lib/server/ai/orchestrator';

test('serializes work for the same lead key', async () => {
  const events: string[] = [];
  let releaseFirst: (() => void) | null = null;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = withLeadProcessingLock('lead:42', async () => {
    events.push('first:start');
    await firstGate;
    events.push('first:end');
  });

  const second = withLeadProcessingLock('lead:42', async () => {
    events.push('second:start');
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(events, ['first:start']);

  releaseFirst?.();
  await Promise.all([first, second]);

  assert.deepEqual(events, ['first:start', 'first:end', 'second:start']);
});

test('prefer-real-lead mode refuses sandbox fallback', () => {
  assert.equal(resolveLeadContextMode(undefined, true), 'error');
  assert.equal(resolveLeadContextMode('lead-123', true), 'real');
  assert.equal(resolveLeadContextMode(undefined, false), 'sandbox');
  assert.equal(resolveLeadContextMode('lead-123', false), 'real');
});
