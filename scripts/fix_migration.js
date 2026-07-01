const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'db', 'migrations', '00000000000000_init.sql');
let t = fs.readFileSync(p, 'utf8');
t = t.replace(/create table /g, 'create table if not exists ');
t = t.replace(/create unique index /g, 'create unique index if not exists ');
t = t.replace(/create index /g, 'create index if not exists ');
// PostgreSQL does not support CREATE POLICY IF NOT EXISTS
// ensure policy statements remain valid
// NOTE: if the policy already exists, the migration may still fail on rerun
// because PostgreSQL has no IF NOT EXISTS for CREATE POLICY.
t = t.replace(/create policy if not exists /g, 'create policy ');
fs.writeFileSync(p, t, 'utf8');
console.log('updated', p);
