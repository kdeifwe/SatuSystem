-- Add 'scheduled_reminder' to notification_log.event_type CHECK constraint
BEGIN;

ALTER TABLE notification_log DROP CONSTRAINT IF EXISTS notification_log_event_type_check;

ALTER TABLE notification_log
  ADD CONSTRAINT notification_log_event_type_check
  CHECK (
    event_type = ANY (ARRAY[
      'new_message'::text,
      'help_request'::text,
      'custom_condition'::text,
      'operator_needed'::text,
      'channel_down'::text,
      'ai_silent'::text,
      'deal_won'::text,
      'deal_lost'::text,
      'new_lead'::text,
      'contact_received'::text,
      'repeat_touches_exhausted'::text,
      'lead_returned'::text,
      'scheduled_failed'::text,
      'ai_error'::text,
      'worker_down'::text,
      'whatsapp_disconnected'::text,
      'kaspi_auth_expired'::text,
      'scheduled_reminder'::text
    ])
  );

COMMIT;

--
-- DOWN (rollback): restore previous constraint without 'scheduled_reminder'
--
-- BEGIN;
--
-- ALTER TABLE notification_log DROP CONSTRAINT IF EXISTS notification_log_event_type_check;
--
-- ALTER TABLE notification_log
--   ADD CONSTRAINT notification_log_event_type_check
--   CHECK (
--     event_type = ANY (ARRAY[
--       'new_message'::text,
--       'help_request'::text,
--       'custom_condition'::text,
--       'operator_needed'::text,
--       'channel_down'::text,
--       'ai_silent'::text,
--       'deal_won'::text,
--       'deal_lost'::text,
--       'new_lead'::text,
--       'contact_received'::text,
--       'repeat_touches_exhausted'::text,
--       'lead_returned'::text,
--       'scheduled_failed'::text,
--       'ai_error'::text,
--       'worker_down'::text,
--       'whatsapp_disconnected'::text,
--       'kaspi_auth_expired'::text
--     ])
--   );
--
-- COMMIT;
