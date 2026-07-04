create or replace function public.fn_get_stats(
  p_org_id uuid,
  p_agent_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text default null,
  p_campaign text default null,
  p_outcome text default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_prev_from timestamptz := p_from - (p_to - p_from);
  v_prev_to timestamptz := p_from;
begin
  if p_org_id is null or auth.uid() is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  if not exists (
    select 1
    from public.org_members om
    where om.org_id = p_org_id
      and om.user_id = auth.uid()
  ) then
    return jsonb_build_object('error', 'forbidden');
  end if;

  return (
    with
      current_conversations as (
        select c.id, c.lead_id, c.agent_id, c.started_at, l.assigned_to, l.source, l.campaign, l.ai_paused_at, l.ai_paused_reason
        from public.conversations c
        join public.leads l on l.id = c.lead_id
        left join public.channels ch on ch.id = l.channel_id
        left join public.agents a on a.id = c.agent_id
        where l.org_id = p_org_id
          and c.started_at >= p_from
          and c.started_at <= p_to
          and (p_agent_id is null or c.agent_id = p_agent_id)
          and (p_channel is null or ch.type = p_channel)
          and (p_campaign is null or l.campaign = p_campaign)
          and (
            p_outcome is null
            or (
              p_outcome = 'goal'
              and exists (
                select 1
                from public.lead_status_history h
                where h.lead_id = l.id
                  and h.new_status = a.goal_status
                  and h.changed_at >= p_from
                  and h.changed_at <= p_to
              )
            )
            or (
              p_outcome = 'undefined_close'
              and exists (
                select 1
                from public.lead_status_history h
                where h.lead_id = l.id
                  and h.new_status = any (a.undefined_close_statuses)
                  and h.changed_at >= p_from
                  and h.changed_at <= p_to
              )
            )
            or (
              p_outcome = 'no_response'
              and exists (
                select 1
                from (
                  select m.conversation_id, max(m.created_at) as last_created_at
                  from public.messages m
                  where m.conversation_id = c.id
                  group by m.conversation_id
                ) lm
                join public.messages last_msg on last_msg.conversation_id = lm.conversation_id and last_msg.created_at = lm.last_created_at
                where last_msg.sender in ('ai', 'operator')
                  and now() - lm.last_created_at > coalesce(a.response_wait_hours, 24) * interval '1 hour'
              )
            )
          )
      ),
      previous_conversations as (
        select c.id, c.lead_id, c.agent_id, c.started_at, l.assigned_to, l.source, l.campaign, l.ai_paused_at, l.ai_paused_reason
        from public.conversations c
        join public.leads l on l.id = c.lead_id
        left join public.channels ch on ch.id = l.channel_id
        left join public.agents a on a.id = c.agent_id
        where l.org_id = p_org_id
          and c.started_at >= v_prev_from
          and c.started_at <= v_prev_to
          and (p_agent_id is null or c.agent_id = p_agent_id)
          and (p_channel is null or ch.type = p_channel)
          and (p_campaign is null or l.campaign = p_campaign)
          and (
            p_outcome is null
            or (
              p_outcome = 'goal'
              and exists (
                select 1
                from public.lead_status_history h
                where h.lead_id = l.id
                  and h.new_status = a.goal_status
                  and h.changed_at >= v_prev_from
                  and h.changed_at <= v_prev_to
              )
            )
            or (
              p_outcome = 'undefined_close'
              and exists (
                select 1
                from public.lead_status_history h
                where h.lead_id = l.id
                  and h.new_status = any (a.undefined_close_statuses)
                  and h.changed_at >= v_prev_from
                  and h.changed_at <= v_prev_to
              )
            )
            or (
              p_outcome = 'no_response'
              and exists (
                select 1
                from (
                  select m.conversation_id, max(m.created_at) as last_created_at
                  from public.messages m
                  where m.conversation_id = c.id
                  group by m.conversation_id
                ) lm
                join public.messages last_msg on last_msg.conversation_id = lm.conversation_id and last_msg.created_at = lm.last_created_at
                where last_msg.sender in ('ai', 'operator')
                  and now() - lm.last_created_at > coalesce(a.response_wait_hours, 24) * interval '1 hour'
              )
            )
          )
      ),
      current_conversion as (
        select distinct cc.lead_id
        from current_conversations cc
        join public.lead_status_history h on h.lead_id = cc.lead_id
        join public.agents a on a.id = cc.agent_id
        where h.new_status = a.goal_status
          and h.changed_at >= p_from
          and h.changed_at <= p_to
      ),
      current_undefined_close as (
        select distinct cc.lead_id
        from current_conversations cc
        join public.lead_status_history h on h.lead_id = cc.lead_id
        join public.agents a on a.id = cc.agent_id
        where h.new_status = any (a.undefined_close_statuses)
          and h.changed_at >= p_from
          and h.changed_at <= p_to
      ),
      current_no_reply as (
        select distinct cc.id as conversation_id
        from current_conversations cc
        join (
          select m.conversation_id, max(m.created_at) as last_created_at
          from public.messages m
          where m.conversation_id in (select id from current_conversations)
          group by m.conversation_id
        ) lm on lm.conversation_id = cc.id
        join public.messages last_msg on last_msg.conversation_id = lm.conversation_id and last_msg.created_at = lm.last_created_at
        join public.agents a on a.id = cc.agent_id
        where last_msg.sender in ('ai', 'operator')
          and now() - lm.last_created_at > coalesce(a.response_wait_hours, 24) * interval '1 hour'
      ),
      current_ai_messages as (
        select cc.id as conversation_id,
               count(*) filter (where m.sender = 'ai' and m.origin = 'conversation') as ai_main_messages,
               count(*) filter (where m.sender = 'ai' and m.origin in ('scenario', 'broadcast', 'followup')) as ai_followup_messages,
               count(*) filter (where m.sender = 'ai') as ai_total_messages
        from current_conversations cc
        left join public.messages m
          on m.conversation_id = cc.id
         and m.created_at >= p_from
         and m.created_at <= p_to
        group by cc.id
      ),
      previous_ai_messages as (
        select cc.id as conversation_id,
               count(*) filter (where m.sender = 'ai' and m.origin = 'conversation') as ai_main_messages,
               count(*) filter (where m.sender = 'ai' and m.origin in ('scenario', 'broadcast', 'followup')) as ai_followup_messages,
               count(*) filter (where m.sender = 'ai') as ai_total_messages
        from previous_conversations cc
        left join public.messages m
          on m.conversation_id = cc.id
         and m.created_at >= v_prev_from
         and m.created_at <= v_prev_to
        group by cc.id
      ),
      client_message_counts as (
        select cc.id as conversation_id, count(*) as message_count
        from current_conversations cc
        left join public.messages m on m.conversation_id = cc.id
        where m.sender = 'user'
          and m.created_at >= p_from
          and m.created_at <= p_to
        group by cc.id
      ),
      ai_message_counts as (
        select cc.id as conversation_id, count(*) as message_count
        from current_conversations cc
        left join public.messages m on m.conversation_id = cc.id
        where m.sender = 'ai'
          and m.created_at >= p_from
          and m.created_at <= p_to
        group by cc.id
      ),
      ai_latency_direct as (
        select avg(l.latency_ms) as avg_latency_ms
        from public.ai_call_logs l
        join current_conversations cc on cc.id = l.conversation_id
        where l.latency_ms is not null
      ),
      ai_latency_fallback as (
        select avg(extract(epoch from delta_ms) * 1000) as avg_latency_ms
        from (
          select conversation_id,
                 created_at - lag(created_at) over (partition by conversation_id order by created_at) as delta_ms
          from (
            select m.conversation_id, m.created_at,
                   lag(m.sender) over (partition by m.conversation_id order by m.created_at) as prev_sender,
                   m.sender
            from public.messages m
            join current_conversations cc on cc.id = m.conversation_id
          ) sub
          where prev_sender = 'user' and sender = 'ai'
        ) pairs
        where delta_ms is not null
      ),
      operator_latency_direct as (
        select avg(l.latency_ms) as avg_latency_ms
        from public.ai_call_logs l
        join current_conversations cc on cc.id = l.conversation_id
        where l.latency_ms is not null
      ),
      operator_latency_fallback as (
        select avg(extract(epoch from delta_ms) * 1000) as avg_latency_ms
        from (
          select conversation_id,
                 created_at - lag(created_at) over (partition by conversation_id order by created_at) as delta_ms
          from (
            select m.conversation_id, m.created_at,
                   lag(m.sender) over (partition by m.conversation_id order by m.created_at) as prev_sender,
                   m.sender
            from public.messages m
            join current_conversations cc on cc.id = m.conversation_id
          ) sub
          where prev_sender = 'user' and sender = 'operator'
        ) pairs
        where delta_ms is not null
      ),
      operator_latency_breakdown as (
        select m.operator_id,
               avg(extract(epoch from delta_ms) * 1000) as avg_response_ms
        from (
          select m.conversation_id, m.operator_id, m.created_at,
                 lag(m.created_at) over (partition by m.conversation_id order by m.created_at) as prev_created_at,
                 m.created_at - lag(m.created_at) over (partition by m.conversation_id order by m.created_at) as delta_ms
          from public.messages m
          join current_conversations cc on cc.id = m.conversation_id
          where m.sender = 'operator'
            and m.operator_id is not null
            and m.created_at >= p_from
            and m.created_at <= p_to
        ) m
        where prev_created_at is not null
        group by m.operator_id
      ),
      source_stats as (
        select coalesce(nullif(cc.source, ''), 'Не указан') as source_name,
               count(distinct cc.id) as conversation_count,
               count(distinct case when exists (
                 select 1
                 from public.lead_status_history h
                 where h.lead_id = cc.lead_id
                   and h.new_status = (select a.goal_status from public.agents a where a.id = cc.agent_id)
                   and h.changed_at >= p_from
                   and h.changed_at <= p_to
               ) then cc.lead_id end) as conversion_count
        from current_conversations cc
        group by 1
      ),
      trend_conversations as (
        select (date_trunc('day', started_at))::date as day,
               count(*) as value
        from current_conversations
        group by 1
      ),
      trend_conversion as (
        select (date_trunc('day', h.changed_at))::date as day,
               count(distinct cc.lead_id) as value
        from current_conversations cc
        join public.lead_status_history h on h.lead_id = cc.lead_id
        join public.agents a on a.id = cc.agent_id
        where h.new_status = a.goal_status
          and h.changed_at >= p_from
          and h.changed_at <= p_to
        group by 1
      ),
      team_stats as (
        select l.assigned_to,
               p.full_name as operator_name,
               count(distinct l.id) as assigned_leads,
               count(distinct case when c.closed_at is not null then c.id end) as handled_chats,
               count(distinct m.id) as operator_messages
        from public.leads l
        left join public.profiles p on p.id = l.assigned_to
        left join public.conversations c on c.lead_id = l.id
        left join public.messages m on m.conversation_id = c.id and m.operator_id = l.assigned_to and m.created_at >= p_from and m.created_at <= p_to
        where l.org_id = p_org_id
          and l.created_at >= p_from
          and l.created_at <= p_to
        group by l.assigned_to, p.full_name
      ),
      ai_latency_value as (
        select case
          when exists (select 1 from ai_latency_direct where avg_latency_ms is not null)
            then (select round(avg_latency_ms::numeric, 2) from ai_latency_direct where avg_latency_ms is not null)
          else (select round(avg_latency_ms::numeric, 2) from ai_latency_fallback where avg_latency_ms is not null)
        end as avg_response_ms
      ),
      operator_latency_value as (
        select case
          when exists (select 1 from operator_latency_direct where avg_latency_ms is not null)
            then (select round(avg_latency_ms::numeric, 2) from operator_latency_direct where avg_latency_ms is not null)
          else (select round(avg_latency_ms::numeric, 2) from operator_latency_fallback where avg_latency_ms is not null)
        end as avg_response_ms
      )
    select jsonb_build_object(
      'dialog_count', (select count(*) from current_conversations),
      'dialog_count_previous', (select count(*) from previous_conversations),
      'dialog_count_change_pct', case
        when (select count(*) from previous_conversations) = 0 then null
        else round(((select count(*) from current_conversations)::numeric - (select count(*) from previous_conversations)::numeric) * 100.0 / nullif((select count(*) from previous_conversations)::numeric, 0), 2)
      end,
      'conversion', jsonb_build_object(
        'count', (select count(*) from current_conversion),
        'pct', case when (select count(*) from current_conversations) = 0 then null else round((select count(*) from current_conversion)::numeric * 100.0 / (select count(*) from current_conversations)::numeric, 2) end,
        'x', (select count(*) from current_conversion),
        'y', (select count(*) from current_conversations)
      ),
      'undefined_close', jsonb_build_object(
        'count', (select count(*) from current_undefined_close),
        'pct', case when (select count(*) from current_conversations) = 0 then null else round((select count(*) from current_undefined_close)::numeric * 100.0 / (select count(*) from current_conversations)::numeric, 2) end
      ),
      'no_response', jsonb_build_object(
        'count', (select count(*) from current_no_reply),
        'pct', case when (select count(*) from current_conversations) = 0 then null else round((select count(*) from current_no_reply)::numeric * 100.0 / (select count(*) from current_conversations)::numeric, 2) end
      ),
      'ai_messages', jsonb_build_object(
        'count', coalesce((select sum(ai_total_messages) from current_ai_messages), 0),
        'main', coalesce((select sum(ai_main_messages) from current_ai_messages), 0),
        'followup', coalesce((select sum(ai_followup_messages) from current_ai_messages), 0),
        'previous_count', coalesce((select sum(ai_total_messages) from previous_ai_messages), 0),
        'change_pct', case
          when coalesce((select sum(ai_total_messages) from previous_ai_messages), 0) = 0 then null
          else round((coalesce((select sum(ai_total_messages) from current_ai_messages), 0)::numeric - coalesce((select sum(ai_total_messages) from previous_ai_messages), 0)::numeric) * 100.0 / nullif(coalesce((select sum(ai_total_messages) from previous_ai_messages), 0)::numeric, 0), 2)
        end
      ),
      'avg_client_messages_per_conversation', (select round(avg(message_count)::numeric, 2) from client_message_counts),
      'avg_ai_messages_per_conversation', (select round(avg(message_count)::numeric, 2) from ai_message_counts),
      'avg_ai_response_time_ms', (select avg_response_ms from ai_latency_value),
      'avg_operator_response_time_ms', (select avg_response_ms from operator_latency_value),
      'handoff', jsonb_build_object(
        'count', (select count(*) from current_conversations where ai_paused_at is not null and ai_paused_at >= p_from and ai_paused_at <= p_to and ai_paused_reason = 'operator_takeover'),
        'pct', case when (select count(*) from current_conversations) = 0 then null else round((select count(*) from current_conversations where ai_paused_at is not null and ai_paused_at >= p_from and ai_paused_at <= p_to and ai_paused_reason = 'operator_takeover')::numeric * 100.0 / (select count(*) from current_conversations)::numeric, 2) end
      ),
      'trends', jsonb_build_object(
        'conversations', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'value', value) order by day) from trend_conversations), '[]'::jsonb),
        'conversion', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'value', value) order by day) from trend_conversion), '[]'::jsonb)
      ),
      'sources', coalesce((select jsonb_agg(jsonb_build_object('source', source_name, 'count', conversation_count, 'conversion_count', conversion_count, 'conversion_pct', case when conversation_count = 0 then null else round(conversion_count::numeric * 100.0 / conversation_count::numeric, 2) end) order by conversation_count desc, source_name) from source_stats), '[]'::jsonb),
      'team', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'assigned_to', assigned_to,
              'operator_name', operator_name,
              'assigned_leads', assigned_leads,
              'handled_chats', handled_chats,
              'operator_messages', operator_messages,
              'avg_response_ms', (
                select avg_response_ms
                from operator_latency_breakdown
                where operator_id = team_stats.assigned_to
              )
            )
            order by assigned_leads desc, operator_name
          )
          from team_stats
        ),
        '[]'::jsonb
      )
    )
  );
end;
$$;
