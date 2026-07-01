alter table leads add column if not exists ai_paused boolean default false;
alter table leads add column if not exists ai_paused_at timestamptz;
alter table leads add column if not exists ai_paused_reason text check (
  ai_paused_reason in ('operator_takeover','working_hours','manual') or ai_paused_reason is null
);
alter table leads add column if not exists last_operator_message_at timestamptz;
