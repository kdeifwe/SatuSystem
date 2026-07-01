create or replace function enqueue_extension_status_notification()
returns trigger as $$
declare
  org_agent_id uuid;
  ext record;
  custom_condition jsonb;
  dedup_count int;
begin
  if TG_OP = 'UPDATE' and new.status is distinct from old.status then
    select a.id into org_agent_id
    from agents a
    where a.org_id = new.org_id
    order by a.created_at
    limit 1;

    if org_agent_id is null then
      return new;
    end if;

    for ext in
      select *
      from extension_settings
      where agent_id = org_agent_id
        and extension_type = 'telegram_notifications'
        and is_active = true
    loop
      for custom_condition in
        select jsonb_array_elements(coalesce(ext.config->'events'->'custom_conditions', '[]'::jsonb))
      loop
        if custom_condition->>'trigger' = 'status_change'
           and custom_condition->>'value' = new.status then
          select count(*) into dedup_count
          from notification_log
          where lead_id = new.id
            and event_type = 'custom_condition'
            and custom_condition_key = custom_condition->>'key'
            and sent_at >= now() - interval '1 minute';

          if dedup_count = 0 then
            insert into notification_log (
              org_id,
              agent_id,
              lead_id,
              event_type,
              custom_condition_key,
              payload,
              delivery_status
            ) values (
              new.org_id,
              org_agent_id,
              new.id,
              'custom_condition',
              custom_condition->>'key',
              jsonb_build_object(
                'status', new.status,
                'lead_name', coalesce(new.name, ''),
                'template', custom_condition->>'template'
              ),
              'pending'
            );
          end if;
        end if;
      end loop;
    end loop;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists leads_status_notification_trigger on leads;
create trigger leads_status_notification_trigger
after update on leads
for each row
execute function enqueue_extension_status_notification();
