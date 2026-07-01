create table if not exists lead_repeat_touch_state (
  lead_id uuid primary key references leads(id) on delete cascade,
  attempts_sent int default 0,
  last_attempt_at timestamptz,
  last_inbound_at timestamptz,
  updated_at timestamptz default now()
);
