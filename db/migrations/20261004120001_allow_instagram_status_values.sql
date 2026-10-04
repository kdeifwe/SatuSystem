ALTER TABLE channels
  DROP CONSTRAINT IF EXISTS channels_connection_status_check;

ALTER TABLE channels
  ADD CONSTRAINT channels_connection_status_check
  CHECK (
    connection_status IN ('disconnected', 'connected', 'qr', 'error', 'challenge', '2fa')
    OR connection_status IS NULL
  )
  NOT VALID;
