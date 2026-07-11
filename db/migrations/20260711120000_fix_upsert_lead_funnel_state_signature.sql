create or replace function public.upsert_lead_funnel_state(
  p_lead_id uuid,
  p_agent_id uuid,
  p_current_node_id text,
  p_status text,
  p_is_no_match boolean,
  p_last_transition_at timestamp with time zone,
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
  last_transition_at timestamp with time zone,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
language plpgsql
as $$
declare
  v_previous_status text;
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
    updated_at = now();

  return query
  select
    lead_funnel_state.id,
    lead_funnel_state.lead_id,
    lead_funnel_state.agent_id,
    lead_funnel_state.current_node_id,
    lead_funnel_state.status,
    lead_funnel_state.retry_count,
    (coalesce(v_previous_status, 'active') = 'paused') as was_already_paused,
    lead_funnel_state.pending_script_node_id,
    lead_funnel_state.pending_script_reply,
    lead_funnel_state.last_transition_at,
    lead_funnel_state.created_at,
    lead_funnel_state.updated_at
  from lead_funnel_state
  where lead_funnel_state.lead_id = p_lead_id
    and lead_funnel_state.agent_id = p_agent_id;
end;
$$;
