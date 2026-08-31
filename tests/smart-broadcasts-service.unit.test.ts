import test from 'node:test';
import assert from 'node:assert/strict';
import { markSmartBroadcastRepliedWithClient } from '../lib/smart-broadcasts/service';

function createFakeSupabase(selectData: Array<{ id: string }>, updateData: Array<{ id: string }> = []) {
  const calls: Array<{ method: string; args: unknown[] }> = [];

  const updateQuery = {
    in(key: string, values: unknown[]) {
      calls.push({ method: 'update.in', args: [key, values] });
      return this;
    },
    select() {
      return Promise.resolve({ data: updateData, error: null });
    },
  };

  const selectQuery = {
    select() {
      return this;
    },
    eq(key: string, value: unknown) {
      calls.push({ method: 'eq', args: [key, value] });
      return this;
    },
    in(key: string, values: unknown[]) {
      calls.push({ method: 'in', args: [key, values] });
      return this;
    },
    is(key: string, value: unknown) {
      calls.push({ method: 'is', args: [key, value] });
      return this;
    },
    update(payload: Record<string, unknown>) {
      calls.push({ method: 'update', args: [payload] });
      return updateQuery;
    },
    then(resolve: (value: { data: Array<{ id: string }> | null; error: null }) => void) {
      return Promise.resolve({ data: selectData, error: null }).then(resolve);
    },
  };

  return {
    calls,
    client: {
      from(table: string) {
        if (table !== 'smart_campaign_recipients') {
          throw new Error(`Unexpected table: ${table}`);
        }
        return selectQuery;
      },
    },
  };
}

test('markSmartBroadcastReplied marks the first response as replied', { concurrency: false }, async () => {
  const { client, calls } = createFakeSupabase([{ id: 'recipient-1' }], [{ id: 'recipient-1' }]);

  const count = await markSmartBroadcastRepliedWithClient('lead-1', 'org-1', client as any);

  assert.equal(count, 1);
  assert.ok(calls.some((entry) => entry.method === 'eq' && entry.args[0] === 'smart_campaigns.org_id' && entry.args[1] === 'org-1'));
  assert.ok(calls.some((entry) => entry.method === 'update' && (entry.args[0] as Record<string, unknown>).status === 'replied'));
});

test('markSmartBroadcastReplied is idempotent on repeated calls', { concurrency: false }, async () => {
  const { client, calls } = createFakeSupabase([]);

  const count = await markSmartBroadcastRepliedWithClient('lead-2', 'org-2', client as any);

  assert.equal(count, 0);
  assert.equal(calls.filter((entry) => entry.method === 'update').length, 0);
});
