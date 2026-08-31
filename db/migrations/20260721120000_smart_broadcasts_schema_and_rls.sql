create table if not exists lead_signals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  lead_id uuid references leads(id) on delete cascade,
  signal_type text not null check (signal_type in (
    'awaiting_funds','awaiting_approval','awaiting_decision',
    'competitor_comparison','busy_later','price_objection','custom'
  )),
  description text not null,
  raw_quote text,
  source_message_id uuid references messages(id),
  suggested_follow_up_at timestamptz,
  status text default 'active' check (status in ('active','resolved','expired','ignored')),
  created_at timestamptz default now(),
  resolved_at timestamptz
);

create index if not exists lead_signals_org_status_idx on lead_signals(org_id, status, signal_type);

alter table lead_signals enable row level security;
create policy "org members see only their org lead_signals"
  on lead_signals for select
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can insert lead_signals"
  on lead_signals for insert
  with check (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can update lead_signals"
  on lead_signals for update
  using (org_id in (select org_id from org_members where user_id = auth.uid()));

create table if not exists smart_campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  name text not null,
  goal_instruction text not null,
  audience_filter jsonb not null,
  requires_approval boolean default true,
  send_pacing_per_minute int default 5,
  respect_work_hours boolean default true,
  max_message_length int default 320,
  status text default 'draft' check (status in (
    'draft','generating','ready_for_review','sending','done','failed','cancelled'
  )),
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  started_at timestamptz,
  finished_at timestamptz
);

alter table smart_campaigns enable row level security;
create policy "org members see only their org smart_campaigns"
  on smart_campaigns for select
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can insert smart_campaigns"
  on smart_campaigns for insert
  with check (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can update smart_campaigns"
  on smart_campaigns for update
  using (org_id in (select org_id from org_members where user_id = auth.uid()));

create table if not exists smart_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references smart_campaigns(id) on delete cascade,
  lead_id uuid references leads(id) on delete cascade,
  signal_id uuid references lead_signals(id),
  generated_message text,
  edited_message text,
  status text default 'pending' check (status in (
    'pending','generated','approved','skipped','sending','sent','failed','replied'
  )),
  skip_reason text,
  ai_call_log_id uuid references ai_call_logs(id),
  sent_at timestamptz,
  replied_at timestamptz,
  created_at timestamptz default now(),
  unique (campaign_id, lead_id)
);

alter table smart_campaign_recipients enable row level security;
create policy "org members see only their org smart_campaign_recipients"
  on smart_campaign_recipients for select
  using (
    campaign_id in (
      select id from smart_campaigns
      where org_id in (select org_id from org_members where user_id = auth.uid())
    )
  );
create policy "org members can insert smart_campaign_recipients"
  on smart_campaign_recipients for insert
  with check (
    campaign_id in (
      select id from smart_campaigns
      where org_id in (select org_id from org_members where user_id = auth.uid())
    )
  );
create policy "org members can update smart_campaign_recipients"
  on smart_campaign_recipients for update
  using (
    campaign_id in (
      select id from smart_campaigns
      where org_id in (select org_id from org_members where user_id = auth.uid())
    )
  );
