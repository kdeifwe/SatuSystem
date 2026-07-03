-- Table to track consecutive Gemini errors per agent
create table if not exists ai_error_counters (
  agent_id uuid primary key references agents(id) on delete cascade,
  consecutive_errors int default 0,
  last_error_at timestamptz,
  last_error_message text,
  updated_at timestamptz default now()
);
