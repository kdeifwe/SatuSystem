import test from 'node:test';
import assert from 'node:assert/strict';

import { getLeadToAutoOpen } from '../app/dashboard/[agentId]/dialogs/lead-auto-selection';

test('returns the URL lead id when it exists in the loaded list and was not selected yet', () => {
  const result = getLeadToAutoOpen({
    leadIdFromUrl: 'lead-2',
    selectedLeadId: null,
    leads: [{ id: 'lead-1' }, { id: 'lead-2' }],
    autoOpenedLeadId: null,
  });

  assert.equal(result, 'lead-2');
});

test('returns null when the URL lead is missing from the loaded list', () => {
  const result = getLeadToAutoOpen({
    leadIdFromUrl: 'lead-3',
    selectedLeadId: null,
    leads: [{ id: 'lead-1' }, { id: 'lead-2' }],
    autoOpenedLeadId: null,
  });

  assert.equal(result, null);
});

test('returns null after the lead was already auto-opened once', () => {
  const result = getLeadToAutoOpen({
    leadIdFromUrl: 'lead-2',
    selectedLeadId: null,
    leads: [{ id: 'lead-1' }, { id: 'lead-2' }],
    autoOpenedLeadId: 'lead-2',
  });

  assert.equal(result, null);
});
