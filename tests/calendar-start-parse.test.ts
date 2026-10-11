import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCalendarStartDate } from '../lib/google-calendar/timezone.ts';

test('parseCalendarStartDate treats bare local times as Asia/Almaty offsets and matches explicit offsets', () => {
  const bare = parseCalendarStartDate('2026-10-12T14:30:00', 'Asia/Almaty');
  const explicit = parseCalendarStartDate('2026-10-12T14:30:00+05:00', 'Asia/Almaty');

  assert.equal(bare.getTime(), explicit.getTime());

  const bareUtc = parseCalendarStartDate('2026-10-12T14:30:00', 'UTC');
  const explicitUtc = parseCalendarStartDate('2026-10-12T14:30:00Z', 'UTC');
  assert.equal(bareUtc.getTime(), explicitUtc.getTime());
});
