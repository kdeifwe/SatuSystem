-- Create function to find leads where AI is silent
create or replace function find_ai_silent_leads(
  p_agent_id uuid,
  p_threshold_minutes int
)
returns table (
  lead_id uuid,
  lead_name text,
  last_message_preview text,
  waiting_minutes numeric,
  agent_id uuid
) as $$
begin
  return query
  select
    l.id,
    l.name::text,
    lm.content::text,
    (extract(epoch from (now() - lm.created_at)) / 60)::numeric,
    p_agent_id
  from leads l
  join conversations c on c.lead_id = l.id
  join lateral (
    select m.content, m.created_at
    from messages m
    where m.conversation_id = c.id and m.sender = 'user'
    order by m.created_at desc
    limit 1
  ) lm on true
  where
    c.agent_id = p_agent_id
    and l.ai_enabled = true
    and l.ai_paused = false
    and extract(epoch from (now() - lm.created_at)) / 60 >= p_threshold_minutes
    and not exists (
      select 1 from messages m_out
      where m_out.conversation_id = c.id
        and m_out.sender in ('ai', 'operator')
        and m_out.created_at > lm.created_at
    )
    and not exists (
      select 1 from notification_log nl
      where nl.lead_id = l.id
        and nl.event_type = 'ai_silent'
        and nl.delivery_status = 'sent'
        and nl.sent_at >= now() - interval '60 minutes'
    )
  order by lm.created_at asc;
end;
$$ language plpgsql;

notify pgrst, 'reload schema';
