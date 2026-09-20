alter table conversations
  add column if not exists sticky_facts jsonb default '[]'::jsonb;
