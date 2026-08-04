import test from 'node:test';
import assert from 'node:assert/strict';
import { isOwnerOrAdminRole } from '../lib/server/permissions';

test('owner and admin roles can delete agents', () => {
  assert.equal(isOwnerOrAdminRole('owner'), true);
  assert.equal(isOwnerOrAdminRole('admin'), true);
});

test('member role cannot delete agents', () => {
  assert.equal(isOwnerOrAdminRole('member'), false);
  assert.equal(isOwnerOrAdminRole(null), false);
  assert.equal(isOwnerOrAdminRole(undefined), false);
});
