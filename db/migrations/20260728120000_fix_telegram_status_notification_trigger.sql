-- Fix Telegram status change notification trigger to include recipient_profile_id
-- and split notifications per configured recipients.

create or replace function enqueue_extension_status_notification()
returns trigger as $$
declare
  org_agent_id uuid;
  ext record;
  custom_condition jsonb;
  dedup_count int;
  assigned_to_profile uuid;
  config jsonb;
  event_enabled boolean;
  recipient_value text;
  recipient_id uuid;
  recipient_ids uuid[];
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

    select assigned_to into assigned_to_profile
    from leads
    where id = new.id;

    for ext in
      select config
      from extension_settings
      where agent_id = org_agent_id
        and extension_type = 'telegram_notifications'
        and is_active = true
    loop
      config := ext.config;
      recipient_ids := array[]::uuid[];

      if config ? 'recipients' and jsonb_typeof(config->'recipients') = 'array' then
        for recipient_value in select jsonb_array_elements_text(config->'recipients')
        loop
          if recipient_value is not null and recipient_value <> '' then
            recipient_ids := array_append(recipient_ids, recipient_value::uuid);
          end if;
        end loop;
      end if;

      if assigned_to_profile is not null then
        recipient_ids := array_append(recipient_ids, assigned_to_profile);
      end if;

      recipient_ids := (
        select coalesce(array_agg(distinct recipient), array[]::uuid[])
        from unnest(recipient_ids) as recipient
        where recipient is not null
      );

      if new.status = 'won' and old.status is distinct from 'won' then
        event_enabled := true;
        if config ? 'events' and config->'events' ? 'deal_won' then
          event_enabled := (config->'events'->'deal_won'->>'enabled')::boolean;
        end if;

        if event_enabled and array_length(recipient_ids, 1) is not null then
          insert into notification_log (
            org_id,
            agent_id,
            lead_id,
            event_type,
            recipient_profile_id,
            payload,
            delivery_status
          )
          select
            new.org_id,
            org_agent_id,
            new.id,
            'deal_won',
            recipient_id,
            jsonb_build_object(
              'lead_name', coalesce(new.name, ''),
              'lead_id', new.id,
              'channel_type', coalesce(new.channel, ''),
              'lead_tags', coalesce(new.tags::text, ''),
              'assigned_to_name', coalesce(new.assigned_to, '')
            ),
            'pending'
          from unnest(recipient_ids) as recipient_id;
        end if;
      end if;

      if new.status = 'lost' and old.status is distinct from 'lost' then
        event_enabled := true;
        if config ? 'events' and config->'events' ? 'deal_lost' then
          event_enabled := (config->'events'->'deal_lost'->>'enabled')::boolean;
        end if;

        if event_enabled and array_length(recipient_ids, 1) is not null then
          insert into notification_log (
            org_id,
            agent_id,
            lead_id,
            event_type,
            recipient_profile_id,
            payload,
            delivery_status
          )
          select
            new.org_id,
            org_agent_id,
            new.id,
            'deal_lost',
            recipient_id,
            jsonb_build_object(
              'lead_name', coalesce(new.name, ''),
              'lead_id', new.id,
              'last_message_preview', '',
              'days_since_created', floor(extract(epoch from (now() - new.created_at)) / 86400)
            ),
            'pending'
          from unnest(recipient_ids) as recipient_id;
        end if;
      end if;

      for custom_condition in
        select jsonb_array_elements(coalesce(config->'events'->'custom_conditions', '[]'::jsonb))
      loop
        if custom_condition->>'trigger' = 'status_change'
           and custom_condition->>'value' = new.status then
          select count(*) into dedup_count
          from notification_log
          where lead_id = new.id
            and event_type = 'custom_condition'
            and custom_condition_key = custom_condition->>'key'
            and sent_at >= now() - interval '1 minute';

          if dedup_count = 0 and array_length(recipient_ids, 1) is not null then
            insert into notification_log (
              org_id,
              agent_id,
              lead_id,
              event_type,
              custom_condition_key,
              recipient_profile_id,
              payload,
              delivery_status
            )
            select
              new.org_id,
              org_agent_id,
              new.id,
              'custom_condition',
              custom_condition->>'key',
              recipient_id,
              jsonb_build_object(
                'status', new.status,
                'lead_name', coalesce(new.name, ''),
                'template', custom_condition->>'template'
              ),
              'pending'
            from unnest(recipient_ids) as recipient_id;
          end if;
        end if;
      end loop;
    end loop;
  end if;

  return new;
end;
$$ language plpgsql;
