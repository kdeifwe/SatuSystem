create table if not exists scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  lead_id uuid references leads(id) on delete cascade,
  conversation_id uuid references conversations(id),
  content text not null,
  send_at timestamptz not null,
  source text not null check (source in ('ai_tool_call','operator_manual','working_hours_queue')),
  status text default 'pending' check (status in ('pending','sent','failed','cancelled')),
  attempts int default 0,
  last_error text,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  sent_at_actual timestamptz
);

create index if not exists scheduled_messages_due_idx
  on scheduled_messages(send_at) where status = 'pending';

alter table scheduled_messages enable row level security;

drop policy if exists "org members manage own org scheduled messages" on scheduled_messages;
create policy "org members manage own org scheduled messages"
  on scheduled_messages for all
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
