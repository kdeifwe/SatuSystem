-- Повторные касания (2-е, 3-е): поиск молчащих диалогов + поля остановки цепочки.

alter table lead_repeat_touch_state add column if not exists stopped_at timestamptz;
alter table lead_repeat_touch_state add column if not exists stop_reason text;

-- Кандидаты на касание: последний диалог лида у агента, где
--  * последнее сообщение от AI и оно не старше p_since,
--  * лид хотя бы раз писал сам,
--  * с последнего сообщения прошло минимум p_min_silence_hours.
-- touches_since_user = сколько касаний (origin = 'followup') отправлено после последнего ответа лида;
-- поэтому счётчик сам обнуляется, когда лид пишет.
create or replace function public.find_repeat_touch_candidates(
  p_agent_id uuid,
  p_since timestamptz,
  p_min_silence_hours float8
)
returns table (
  conversation_id uuid,
  lead_id uuid,
  last_message_at timestamptz,
  last_user_at timestamptz,
  touches_since_user int,
  last_touch_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with convs as (
    select distinct on (c.lead_id) c.id, c.lead_id
    from conversations c
    where c.agent_id = p_agent_id
      and coalesce(c.is_sandbox, false) = false
    order by c.lead_id, c.started_at desc
  ),
  last_msg as (
    select distinct on (m.conversation_id) m.conversation_id, m.sender, m.created_at
    from messages m
    join convs on convs.id = m.conversation_id
    where m.sender in ('user', 'ai', 'operator')
    order by m.conversation_id, m.created_at desc
  ),
  last_user as (
    select m.conversation_id, max(m.created_at) as at
    from messages m
    join convs on convs.id = m.conversation_id
    where m.sender = 'user'
    group by m.conversation_id
  ),
  touches as (
    select m.conversation_id, count(*)::int as n, max(m.created_at) as last_at
    from messages m
    join convs on convs.id = m.conversation_id
    left join last_user lu on lu.conversation_id = m.conversation_id
    where m.origin = 'followup'
      and m.sender = 'ai'
      and m.created_at > coalesce(lu.at, '-infinity'::timestamptz)
    group by m.conversation_id
  )
  select convs.id, convs.lead_id, lm.created_at, lu.at, coalesce(t.n, 0), t.last_at
  from convs
  join last_msg lm on lm.conversation_id = convs.id
  join last_user lu on lu.conversation_id = convs.id
  left join touches t on t.conversation_id = convs.id
  where lm.sender = 'ai'
    and lm.created_at >= p_since
    and lm.created_at <= now() - (p_min_silence_hours * interval '1 hour')
  order by lm.created_at asc
  limit 500;
$$;

revoke all on function public.find_repeat_touch_candidates(uuid, timestamptz, float8) from public, anon, authenticated;
grant execute on function public.find_repeat_touch_candidates(uuid, timestamptz, float8) to service_role;
