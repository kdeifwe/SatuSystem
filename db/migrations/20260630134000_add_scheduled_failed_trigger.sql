-- Enqueue notification when scheduled_messages becomes failed after retries
create or replace function enqueue_scheduled_failed_notification()
returns trigger as $$
begin
  if TG_OP = 'UPDATE' and new.status = 'failed' and old.status is distinct from 'failed' then
    -- Only enqueue if attempts >= 5
    if new.attempts >= 5 then
      insert into notification_log (
        org_id,
        agent_id,
        lead_id,
        event_type,
        payload,
        delivery_status
      ) values (
        new.org_id,
        (select a.id from agents a where a.org_id = new.org_id order by a.created_at limit 1),
        new.lead_id,
        'scheduled_failed',
        jsonb_build_object(
          'lead_id', new.lead_id,
          'lead_name', coalesce((select name from leads where id = new.lead_id), ''),
          'message_preview', left(new.content, 200),
          'scheduled_message_id', new.id,
          'last_error', coalesce(new.last_error, '')
        ),
        'pending'
      );
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists scheduled_messages_failed_trigger on scheduled_messages;
create trigger scheduled_messages_failed_trigger
after update on scheduled_messages
for each row
when (old.status is distinct from new.status)
execute function enqueue_scheduled_failed_notification();
