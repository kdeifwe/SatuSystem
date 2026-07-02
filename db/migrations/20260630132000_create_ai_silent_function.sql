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
    l.name,
    (m_in.content)::text,
    extract(epoch from (now() - max(m_in.created_at)))/60,
    p_agent_id
  from leads l
  join conversations c on c.lead_id = l.id
  join messages m_in on m_in.conversation_id = c.id and m_in.sender = 'user'
  where
    c.agent_id = p_agent_id
    and l.ai_enabled = true
    and l.ai_paused = false
    -- Last inbound is older than threshold
    and extract(epoch from (now() - max(m_in.created_at)))/60 >= p_threshold_minutes
    -- No AI or operator response after last user message
    and not exists (
      select 1 from messages m_out
      where m_out.conversation_id = c.id
        and m_out.sender in ('ai', 'operator')
        and m_out.created_at > (
          select max(created_at) from messages
          where conversation_id = c.id and sender = 'user'
        )
    )
    -- No ai_silent notification already sent within last 60 minutes
    and not exists (
      select 1 from notification_log nl
      where nl.lead_id = l.id
        and nl.event_type = 'ai_silent'
        and nl.delivery_status = 'sent'
        and nl.sent_at >= now() - interval '60 minutes'
    )
  group by l.id, l.name, m_in.content
  order by max(m_in.created_at) asc;
end;
$$ language plpgsql;
