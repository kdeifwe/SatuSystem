import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAgentVisibilityFilter } from '../lib/agents/visibility';

test('applies deleted_at is null filter to agent queries', () => {
  const calls: Array<[string, unknown]> = [];
  const query = {
    is(column: string, value: unknown) {
      calls.push([column, value]);
      return this;
    },
  };

  const result = applyAgentVisibilityFilter(query as any);

  assert.equal(result, query);
  assert.deepEqual(calls, [['deleted_at', null]]);
});
