create table if not exists extension_settings (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references agents(id) on delete cascade,
  extension_type text not null check (extension_type in (
    'telegram_notifications',
    'repeat_touches',
    'auto_switch',
    'working_hours',
    'scheduled_messages',
    'message_delay',
    'message_splitting'
  )),
  is_active boolean default false,
  config jsonb not null default '{}',
  updated_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (agent_id, extension_type)
);

alter table extension_settings enable row level security;

drop policy if exists "org members manage own org extension settings" on extension_settings;
create policy "org members manage own org extension settings"
  on extension_settings for all
  using (
    agent_id in (
      select a.id
      from agents a
      join org_members om on om.org_id = a.org_id
      where om.user_id = auth.uid()
    )
  );
