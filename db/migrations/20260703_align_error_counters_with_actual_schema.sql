-- Align channel_error_counters and ai_error_counters with actual production schema
-- This migration is idempotent: it adds missing columns if they do not exist.

-- Add missing columns to channel_error_counters
ALTER TABLE channel_error_counters
  ADD COLUMN IF NOT EXISTS channel_id uuid;

ALTER TABLE channel_error_counters
  ADD COLUMN IF NOT EXISTS last_error_message text;

ALTER TABLE channel_error_counters
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Add missing columns to ai_error_counters
ALTER TABLE ai_error_counters
  ADD COLUMN IF NOT EXISTS last_error_message text;

ALTER TABLE ai_error_counters
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Remove legacy subscriptions table if present
DROP TABLE IF EXISTS subscriptions;
