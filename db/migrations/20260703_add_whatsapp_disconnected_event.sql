-- Add whatsapp_disconnected to notification_log event_type constraint
ALTER TABLE notification_log
DROP CONSTRAINT notification_log_event_type_check;

ALTER TABLE notification_log
ADD CONSTRAINT notification_log_event_type_check CHECK (event_type IN (
  'new_message',
  'help_request',
  'custom_condition',
  'operator_needed',
  'channel_down',
  'ai_silent',
  'deal_won',
  'deal_lost',
  'new_lead',
  'contact_received',
  'repeat_touches_exhausted',
  'lead_returned',
  'scheduled_failed',
  'ai_error',
  'worker_down',
  'whatsapp_disconnected'
));
