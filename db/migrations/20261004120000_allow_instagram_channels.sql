-- Allow Instagram channels and keep connection statuses aligned with runtime lifecycle.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'channels'
      AND constraint_type = 'CHECK'
      AND constraint_name = 'channels_type_check'
  ) THEN
    ALTER TABLE channels DROP CONSTRAINT channels_type_check;
  END IF;
END $$;

ALTER TABLE channels
  DROP CONSTRAINT IF EXISTS channels_type_check;

ALTER TABLE channels
  ALTER COLUMN type TYPE text;

ALTER TABLE channels
  ADD CONSTRAINT channels_type_check
  CHECK (type IN ('whatsapp', 'telegram', 'instagram'))
  NOT VALID;

ALTER TABLE channels
  ADD CONSTRAINT channels_connection_status_check
  CHECK (connection_status IN ('disconnected', 'connected', 'qr', 'error', 'challenge', '2fa'))
  NOT VALID;
