alter table profiles add column if not exists telegram_chat_id text;
alter table profiles add column if not exists telegram_link_token text;
alter table profiles add column if not exists telegram_link_token_expires_at timestamptz;
