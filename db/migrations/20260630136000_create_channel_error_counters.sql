-- Track consecutive send errors per channel type
create table if not exists channel_error_counters (
  channel_id uuid primary key,
  consecutive_errors int default 0,
  last_error_at timestamptz,
  last_error_message text,
  updated_at timestamptz default now()
);
