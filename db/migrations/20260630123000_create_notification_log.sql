create table if not exists notification_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  agent_id uuid references agents(id),
  lead_id uuid references leads(id),
  event_type text not null check (event_type in ('new_message','help_request','custom_condition')),
  custom_condition_key text,
  recipient_profile_id uuid references profiles(id),
  payload jsonb,
  sent_at timestamptz default now(),
  delivery_status text default 'pending' check (delivery_status in ('pending','sent','failed')),
  attempts int default 0,
  last_error text
);

create index if not exists notification_log_dedup_idx
  on notification_log(lead_id, event_type, custom_condition_key, sent_at);
