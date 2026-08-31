import test from 'node:test';
import assert from 'node:assert/strict';
import { filterSignalsForTable, buildCampaignTimeline, getActiveSignalsCount } from '../app/dashboard/[agentId]/broadcasts/utils';

test('filterSignalsForTable applies type, date and lead-status filters', () => {
  const signals = [
    {
      id: '1',
      lead_id: 'lead-1',
      lead_name: 'Айгерим',
      lead_status: 'active',
      signal_type: 'awaiting_funds',
      description: 'Ждёт зарплату',
      raw_quote: 'Куплю после зарплаты',
      status: 'active',
      created_at: '2026-07-20T10:00:00.000Z',
    },
    {
      id: '2',
      lead_id: 'lead-2',
      lead_name: 'Нурлан',
      lead_status: 'won',
      signal_type: 'awaiting_approval',
      description: 'Согласует с супругой',
      raw_quote: 'Могу после разговора с мужем',
      status: 'active',
      created_at: '2026-07-18T08:00:00.000Z',
    },
    {
      id: '3',
      lead_id: 'lead-3',
      lead_name: 'Алия',
      lead_status: 'inactive',
      signal_type: 'busy_later',
      description: 'Вернётся позже',
      raw_quote: 'Напишу через неделю',
      status: 'resolved',
      created_at: '2026-07-10T12:00:00.000Z',
    },
  ] as any[];

  const filtered = filterSignalsForTable(signals, {
    signalType: 'awaiting_funds',
    dateRange: '7d',
    leadStatus: 'active',
  }, new Date('2026-07-22T12:00:00.000Z'));

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, '1');
});

test('getActiveSignalsCount counts only active signals', () => {
  const signals = [
    { id: '1', status: 'active' },
    { id: '2', status: 'active' },
    { id: '3', status: 'resolved' },
  ] as any[];

  assert.equal(getActiveSignalsCount(signals), 2);
});

test('buildCampaignTimeline aggregates recipient statuses by day', () => {
  const recipients = [
    { id: '1', status: 'sent', sent_at: '2026-07-20T10:00:00.000Z' },
    { id: '2', status: 'replied', sent_at: '2026-07-20T11:00:00.000Z', replied_at: '2026-07-20T12:00:00.000Z' },
    { id: '3', status: 'failed', sent_at: '2026-07-19T09:00:00.000Z' },
    { id: '4', status: 'skipped', sent_at: '2026-07-18T08:00:00.000Z' },
  ] as any[];

  const timeline = buildCampaignTimeline(recipients, new Date('2026-07-22T12:00:00.000Z'));

  assert.equal(timeline.length, 5);
  assert.equal(timeline[0].date, '2026-07-18');
  assert.equal(timeline[0].skipped, 1);
  assert.equal(timeline[2].sent, 1);
  assert.equal(timeline[2].replied, 1);
});
