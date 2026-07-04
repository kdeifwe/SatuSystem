const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStatsExportData } = require('../lib/stats/export.ts');

test('buildStatsExportData creates expected worksheets and respects filters', () => {
  const data = {
    conversion: { pct: 45, count: 9, x: 9, y: 20 },
    undefined_close: { pct: 10, count: 2 },
    no_response: { pct: 5, count: 1 },
    ai_messages: { count: 12, main: 7, followup: 5, previous_count: 8, change_pct: 50 },
    avg_client_messages_per_conversation: 2.5,
    avg_ai_messages_per_conversation: 1.2,
    avg_ai_response_time_ms: 180000,
    avg_operator_response_time_ms: 240000,
    handoff: { count: 3, pct: 15 },
    trends: {
      conversations: [{ day: '2024-01-01', value: 4 }],
      conversion: [{ day: '2024-01-01', value: 50 }],
    },
    sources: [{ source: 'Instagram', count: 3, conversion_count: 2, conversion_pct: 67 }],
    team: [{ assigned_to: 'alice', operator_name: 'Alice', assigned_leads: 5, handled_chats: 4, operator_messages: 8, avg_response_ms: 120000 }],
  } as any;

  const exportData = buildStatsExportData(data, {
    period: 'month',
    channel: 'telegram',
    campaign: 'summer',
    outcome: 'goal',
  });

  assert.deepEqual(exportData.sheets.map(sheet => sheet.name), [
    'Сводка',
    'Тренды по дням',
    'Источники лидов',
    'Команда',
  ]);
  assert.equal(exportData.sheets[0].rows[4][1], 'telegram');
  assert.equal(exportData.sheets[2].rows[1][0], 'Instagram');
});
