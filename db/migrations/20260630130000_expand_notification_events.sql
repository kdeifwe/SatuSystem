-- Expand event_type enum in notification_log to support all notification scenarios
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
  'worker_down'
));

-- Add index for dedup by event_type for faster lookups
CREATE INDEX IF NOT EXISTS notification_log_event_type_idx 
  ON notification_log(event_type, lead_id, agent_id, org_id, sent_at);

-- Add index for pending messages
CREATE INDEX IF NOT EXISTS notification_log_pending_idx
  ON notification_log(delivery_status, sent_at)
  WHERE delivery_status = 'pending';
