-- Create trigger for new_lead event
-- When a new lead is created, queue a notification
create or replace function enqueue_new_lead_notification()
returns trigger as $$
declare
  org_agent_id uuid;
begin
  -- Get the primary agent for the org
  select a.id into org_agent_id
  from agents a
  where a.org_id = new.org_id
  order by a.created_at
  limit 1;

  if org_agent_id is not null then
    insert into notification_log (
      org_id,
      agent_id,
      lead_id,
      event_type,
      payload,
      delivery_status
    ) values (
      new.org_id,
      org_agent_id,
      new.id,
      'new_lead',
      jsonb_build_object(
        'lead_id', new.id,
        'lead_name', coalesce(new.name, 'Без имени'),
        'channel_type', coalesce(new.channel, ''),
        'first_message_preview', '',
        'time', now()::text
      ),
      'pending'
    );
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists leads_new_lead_notification_trigger on leads;
create trigger leads_new_lead_notification_trigger
after insert on leads
for each row
execute function enqueue_new_lead_notification();
