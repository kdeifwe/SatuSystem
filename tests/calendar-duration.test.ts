import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveDurationMinutes } from '../lib/google-calendar/duration.ts';
import { buildToolDeclarationsForAgent } from '../lib/ai/tools/registry.ts';

test('resolveDurationMinutes defaults to 60 and clamps valid values by priority', () => {
  assert.equal(resolveDurationMinutes(undefined), 60);
  assert.equal(resolveDurationMinutes(null), 60);
  assert.equal(resolveDurationMinutes(''), 60);
  assert.equal(resolveDurationMinutes('abc'), 60);
  assert.equal(resolveDurationMinutes(0), 60);
  assert.equal(resolveDurationMinutes(-30), 60);
  assert.equal(resolveDurationMinutes(NaN), 60);

  assert.equal(resolveDurationMinutes(15), 15);
  assert.equal(resolveDurationMinutes(30), 30);
  assert.equal(resolveDurationMinutes(40), 40);
  assert.equal(resolveDurationMinutes(60), 60);
  assert.equal(resolveDurationMinutes(90), 90);
  assert.equal(resolveDurationMinutes(100), 100);

  assert.equal(resolveDurationMinutes('90'), 90);
  assert.equal(resolveDurationMinutes(44.6), 45);
  assert.equal(resolveDurationMinutes(5), 15);
  assert.equal(resolveDurationMinutes(1000), 240);

  assert.equal(resolveDurationMinutes('abc', 90, 45), 90);
  assert.equal(resolveDurationMinutes(null, '90', 60), 90);
});

test('calendar tool declarations expose duration_minutes and avoid fixed-duration wording', () => {
  const previousEmail = process.env.GOOGLE_SA_EMAIL;
  const previousPrivateKey = process.env.GOOGLE_SA_PRIVATE_KEY;
  const previousCalendarId = process.env.GOOGLE_CALENDAR_ID;

  process.env.GOOGLE_SA_EMAIL = 'service-account@test.example';
  process.env.GOOGLE_SA_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----\n';
  process.env.GOOGLE_CALENDAR_ID = 'primary';

  try {
    const declarations = buildToolDeclarationsForAgent(
      ['checkCalendarAvailability', 'createCalendarEvent'],
      { google_calendar_enabled: true },
      null,
      [],
    );

    const availability = declarations.find((tool) => tool.name === 'checkCalendarAvailability');
    const event = declarations.find((tool) => tool.name === 'createCalendarEvent');

    assert.ok(availability, 'checkCalendarAvailability declaration should exist');
    assert.ok(event, 'createCalendarEvent declaration should exist');
    assert.ok((availability?.parameters?.properties as Record<string, { type?: string }>).duration_minutes, 'duration_minutes should exist for availability');
    assert.ok((event?.parameters?.properties as Record<string, { type?: string }>).duration_minutes, 'duration_minutes should exist for event creation');
    assert.doesNotMatch(String(event?.description ?? ''), /фиксированному/i);
  } finally {
    if (previousEmail === undefined) delete process.env.GOOGLE_SA_EMAIL; else process.env.GOOGLE_SA_EMAIL = previousEmail;
    if (previousPrivateKey === undefined) delete process.env.GOOGLE_SA_PRIVATE_KEY; else process.env.GOOGLE_SA_PRIVATE_KEY = previousPrivateKey;
    if (previousCalendarId === undefined) delete process.env.GOOGLE_CALENDAR_ID; else process.env.GOOGLE_CALENDAR_ID = previousCalendarId;
  }
});
