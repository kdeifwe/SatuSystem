-- Expand leads trigger to handle deal_won and deal_lost notifications
-- This extends the existing trigger to enqueue notifications for status changes

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

    -- Handle deal_won event
    if new.status = 'won' and old.status is distinct from 'won' then
      select agent_id into org_agent_id
      from conversations
      where lead_id = new.id
      limit 1;

      if org_agent_id is null then
        select a.id into org_agent_id
        from agents a
        where a.org_id = new.org_id
        order by a.created_at
        limit 1;
      end if;

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
          'deal_won',
          jsonb_build_object(
            'lead_name', coalesce(new.name, ''),
            'lead_id', new.id,
            'channel_type', coalesce(new.channel, ''),
            'lead_tags', coalesce(new.tags::text, ''),
            'assigned_to_name', coalesce(new.assigned_to, '')
          ),
          'pending'
        );
      end if;
    end if;

    -- Handle deal_lost event
    if new.status = 'lost' and old.status is distinct from 'lost' then
      select agent_id into org_agent_id
      from conversations
      where lead_id = new.id
      limit 1;

      if org_agent_id is null then
        select a.id into org_agent_id
        from agents a
        where a.org_id = new.org_id
        order by a.created_at
        limit 1;
      end if;

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
          'deal_lost',
          jsonb_build_object(
            'lead_name', coalesce(new.name, ''),
            'lead_id', new.id,
            'last_message_preview', '',
            'days_since_created', floor(extract(epoch from (now() - new.created_at)) / 86400)
          ),
          'pending'
        );
      end if;
    end if;

    -- Handle custom conditions (existing logic)
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
