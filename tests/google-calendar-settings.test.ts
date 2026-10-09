import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('google calendar settings remain outside the v1 API surface', () => {
  assert.equal(fs.existsSync('app/api/google-calendar/settings/route.ts'), false);
  const dashboardPage = fs.readFileSync('app/dashboard/[agentId]/integrations/page.tsx', 'utf8');
  assert.doesNotMatch(dashboardPage, /\/api\/google-calendar\/settings/);
});
