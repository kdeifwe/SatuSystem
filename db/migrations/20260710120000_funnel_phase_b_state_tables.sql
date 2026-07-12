create table if not exists lead_funnel_state (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  current_node_id text,
  status text not null default 'active' check (status in ('active', 'completed', 'paused', 'archived')),
  retry_count integer not null default 0,
  last_transition_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (lead_id, agent_id)
);

alter table lead_funnel_state
  add column if not exists retry_count integer not null default 0;

create or replace function upsert_lead_funnel_state(
  p_lead_id uuid,
  p_agent_id uuid,
  p_current_node_id text,
  p_status text,
  p_is_no_match boolean,
  p_last_transition_at timestamptz,
  p_pending_script_node_id text default null::text,
  p_pending_script_reply text default null::text
)
returns table (
  id uuid,
  lead_id uuid,
  agent_id uuid,
  current_node_id text,
  status text,
  retry_count integer,
  was_already_paused boolean,
  pending_script_node_id text,
  pending_script_reply text,
  last_transition_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
as $$
declare
  v_previous_status text;
  v_id uuid;
  v_lead_id uuid;
  v_agent_id uuid;
  v_current_node_id text;
  v_status text;
  v_retry_count integer;
  v_pending_script_node_id text;
  v_pending_script_reply text;
  v_last_transition_at timestamptz;
  v_created_at timestamptz;
  v_updated_at timestamptz;
  v_was_already_paused boolean;
begin
  select lead_funnel_state.status
    into v_previous_status
  from lead_funnel_state
  where lead_funnel_state.lead_id = p_lead_id
    and lead_funnel_state.agent_id = p_agent_id
  for update;

  if not found then
    v_previous_status := null;
  end if;

  insert into lead_funnel_state (
    lead_id,
    agent_id,
    current_node_id,
    status,
    retry_count,
    pending_script_node_id,
    pending_script_reply,
    last_transition_at,
    updated_at
  ) values (
    p_lead_id,
    p_agent_id,
    p_current_node_id,
    p_status,
    case
      when p_is_no_match then 1
      else 0
    end,
    p_pending_script_node_id,
    p_pending_script_reply,
    p_last_transition_at,
    now()
  )
  on conflict on constraint lead_funnel_state_lead_id_agent_id_key
  do update set
    current_node_id = excluded.current_node_id,
    status = excluded.status,
    retry_count = case
      when p_is_no_match then lead_funnel_state.retry_count + 1
      else 0
    end,
    pending_script_node_id = excluded.pending_script_node_id,
    pending_script_reply = excluded.pending_script_reply,
    last_transition_at = excluded.last_transition_at,
    updated_at = now()
  returning
    lead_funnel_state.id,
    lead_funnel_state.lead_id,
    lead_funnel_state.agent_id,
    lead_funnel_state.current_node_id,
    lead_funnel_state.status,
    lead_funnel_state.retry_count,
    lead_funnel_state.pending_script_node_id,
    lead_funnel_state.pending_script_reply,
    lead_funnel_state.last_transition_at,
    lead_funnel_state.created_at,
    lead_funnel_state.updated_at
  into
    v_id,
    v_lead_id,
    v_agent_id,
    v_current_node_id,
    v_status,
    v_retry_count,
    v_pending_script_node_id,
    v_pending_script_reply,
    v_last_transition_at,
    v_created_at,
    v_updated_at;

  v_was_already_paused := (coalesce(v_previous_status, 'active') = 'paused');

  return query
  select
    v_id,
    v_lead_id,
    v_agent_id,
    v_current_node_id,
    v_status,
    v_retry_count,
    v_was_already_paused,
    v_last_transition_at,
    v_created_at,
    v_updated_at;
end;
$$;

create table if not exists funnel_transitions_log (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  from_node_id text,
  to_node_id text,
  condition text,
  classification_confidence numeric,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

create index if not exists lead_funnel_state_agent_updated_idx
  on lead_funnel_state (agent_id, updated_at desc);

create index if not exists lead_funnel_state_lead_idx
  on lead_funnel_state (lead_id);

create index if not exists funnel_transitions_log_lead_created_idx
  on funnel_transitions_log (lead_id, created_at desc);

create index if not exists funnel_transitions_log_agent_created_idx
  on funnel_transitions_log (agent_id, created_at desc);

alter table lead_funnel_state enable row level security;
alter table funnel_transitions_log enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'lead_funnel_state'
      and policyname = 'org members can select lead_funnel_state'
  ) then
    create policy "org members can select lead_funnel_state"
      on lead_funnel_state for select
      using (
        exists (
          select 1
          from leads l
          join agents a on a.id = lead_funnel_state.agent_id
          join org_members om on om.org_id = a.org_id
          where l.id = lead_funnel_state.lead_id
            and om.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'lead_funnel_state'
      and policyname = 'org members can insert lead_funnel_state'
  ) then
    create policy "org members can insert lead_funnel_state"
      on lead_funnel_state for insert
      with check (
        exists (
          select 1
          from agents a
          join org_members om on om.org_id = a.org_id
          where a.id = lead_funnel_state.agent_id
            and om.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'lead_funnel_state'
      and policyname = 'org members can update lead_funnel_state'
  ) then
    create policy "org members can update lead_funnel_state"
      on lead_funnel_state for update
      using (
        exists (
          select 1
          from agents a
          join org_members om on om.org_id = a.org_id
          where a.id = lead_funnel_state.agent_id
            and om.user_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1
          from agents a
          join org_members om on om.org_id = a.org_id
          where a.id = lead_funnel_state.agent_id
            and om.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'lead_funnel_state'
      and policyname = 'org members can delete lead_funnel_state'
  ) then
    create policy "org members can delete lead_funnel_state"
      on lead_funnel_state for delete
      using (
        exists (
          select 1
          from agents a
          join org_members om on om.org_id = a.org_id
          where a.id = lead_funnel_state.agent_id
            and om.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'funnel_transitions_log'
      and policyname = 'org members can select funnel_transitions_log'
  ) then
    create policy "org members can select funnel_transitions_log"
      on funnel_transitions_log for select
      using (
        exists (
          select 1
          from agents a
          join org_members om on om.org_id = a.org_id
          where a.id = funnel_transitions_log.agent_id
            and om.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'funnel_transitions_log'
      and policyname = 'org members can insert funnel_transitions_log'
  ) then
    create policy "org members can insert funnel_transitions_log"
      on funnel_transitions_log for insert
      with check (
        exists (
          select 1
          from agents a
          join org_members om on om.org_id = a.org_id
          where a.id = funnel_transitions_log.agent_id
            and om.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'funnel_transitions_log'
      and policyname = 'org members can update funnel_transitions_log'
  ) then
    create policy "org members can update funnel_transitions_log"
      on funnel_transitions_log for update
      using (
        exists (
          select 1
          from agents a
          join org_members om on om.org_id = a.org_id
          where a.id = funnel_transitions_log.agent_id
            and om.user_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1
          from agents a
          join org_members om on om.org_id = a.org_id
          where a.id = funnel_transitions_log.agent_id
            and om.user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'funnel_transitions_log'
      and policyname = 'org members can delete funnel_transitions_log'
  ) then
    create policy "org members can delete funnel_transitions_log"
      on funnel_transitions_log for delete
      using (
        exists (
          select 1
          from agents a
          join org_members om on om.org_id = a.org_id
          where a.id = funnel_transitions_log.agent_id
            and om.user_id = auth.uid()
        )
      );
  end if;
end;
$$;
