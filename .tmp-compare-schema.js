const fs = require('fs');

// Read schema columns from freshly exported file
const json = JSON.parse(fs.readFileSync('backups/20260703_1054/schema-key-tables.json', 'utf8'));

// Tables to check
const tables = [
  'extension_settings',
  'notification_log',
  'lead_repeat_touch_state',
  'scheduled_messages',
  'ai_error_counters',
  'channel_error_counters',
  'subscriptions'
];

tables.forEach(t => {
  const cols = json.filter(x => x.table_name === t);
  console.log(`\n=== ${t} (${cols.length} columns) ===`);
  cols.forEach(c => {
    const nullable = c.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
    const def = c.column_default ? ` DEFAULT ${c.column_default}` : '';
    console.log(`  ${c.column_name}: ${c.data_type}${def} ${nullable}`);
  });
});

console.log('\n\n=== SUBSCRIPTIONS details ===');
const subsCols = json.filter(x => x.table_name === 'subscriptions');
console.log(JSON.stringify(subsCols, null, 2));
