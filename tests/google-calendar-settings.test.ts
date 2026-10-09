import test from 'node:test';
import assert from 'node:assert/strict';
import { googleCalendarSettingsSchema } from '../app/api/google-calendar/settings/route.ts';

test('googleCalendarSettingsSchema accepts enabled boolean and requires agentId', () => {
  assert.deepEqual(googleCalendarSettingsSchema.parse({ agentId: 'agent-1', enabled: true }), {
    agentId: 'agent-1',
    enabled: true,
  });

  assert.deepEqual(googleCalendarSettingsSchema.parse({ agentId: 'agent-1' }), {
    agentId: 'agent-1',
  });

  assert.throws(() => googleCalendarSettingsSchema.parse({ enabled: true }), /agentId/);
  assert.throws(() => googleCalendarSettingsSchema.parse({ agentId: '' }), /agentId/);
});
