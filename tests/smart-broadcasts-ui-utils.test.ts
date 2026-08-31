import test from 'node:test';
import assert from 'node:assert/strict';
import { filterSignalsForAudience, pickPreviewSignals } from '../app/dashboard/[agentId]/broadcasts/utils';

test('filters signals by selected types and minimum age', () => {
  const signals = [
    { id: '1', lead_id: 'lead-1', signal_type: 'awaiting_funds', description: 'salary', raw_quote: null, status: 'active', created_at: '2024-01-01T00:00:00.000Z' },
    { id: '2', lead_id: 'lead-2', signal_type: 'awaiting_approval', description: 'approval', raw_quote: null, status: 'active', created_at: '2024-01-02T00:00:00.000Z' },
    { id: '3', lead_id: 'lead-3', signal_type: 'competitor_comparison', description: 'compare', raw_quote: null, status: 'active', created_at: '2024-01-03T00:00:00.000Z' },
  ] as Array<{
    id: string;
    lead_id: string;
    signal_type: string;
    description: string;
    raw_quote?: string | null;
    status: string;
    created_at: string;
  }>;

  const filtered = filterSignalsForAudience(signals, ['awaiting_funds', 'awaiting_approval'], 0, new Date('2024-01-03T00:00:00.000Z'));

  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map((signal) => signal.lead_id), ['lead-1', 'lead-2']);
});

test('picks a random preview sample without changing the audience filter', () => {
  const signals = [
    { id: '1', lead_id: 'lead-1', signal_type: 'awaiting_funds', description: 'salary', raw_quote: null, status: 'active', created_at: '2024-01-01T00:00:00.000Z' },
    { id: '2', lead_id: 'lead-2', signal_type: 'awaiting_funds', description: 'salary', raw_quote: null, status: 'active', created_at: '2024-01-02T00:00:00.000Z' },
    { id: '3', lead_id: 'lead-3', signal_type: 'awaiting_approval', description: 'approval', raw_quote: null, status: 'active', created_at: '2024-01-03T00:00:00.000Z' },
  ] as Array<{
    id: string;
    lead_id: string;
    signal_type: string;
    description: string;
    raw_quote?: string | null;
    status: string;
    created_at: string;
  }>;

  const preview = pickPreviewSignals(signals, ['awaiting_funds'], 0, 2, new Date('2024-01-03T00:00:00.000Z'), () => 0.1);

  assert.equal(preview.length, 2);
  assert.deepEqual(preview.map((signal) => signal.lead_id), ['lead-2', 'lead-1']);
});
