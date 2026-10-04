-- Allow Instagram channels and keep connection statuses aligned with runtime lifecycle.
ALTER TABLE channels
  DROP CONSTRAINT IF EXISTS channels_type_check;

ALTER TABLE channels
  ADD CONSTRAINT channels_type_check
  CHECK (type IN ('whatsapp', 'telegram', 'telegram_userbot', 'instagram') OR type IS NULL)
  NOT VALID;

ALTER TABLE channels
  DROP CONSTRAINT IF EXISTS channels_connection_status_check;

ALTER TABLE channels
  ADD CONSTRAINT channels_connection_status_check
  CHECK (
    connection_status IN ('disconnected', 'connected', 'qr', 'error', 'challenge', '2fa')
    OR connection_status IS NULL
  )
  NOT VALID;
