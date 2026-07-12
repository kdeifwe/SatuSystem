ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS is_sandbox boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS conversations_is_sandbox_idx ON conversations (is_sandbox, agent_id, created_at);
