alter table conversations
  add column if not exists summary text;

alter table conversations
  add column if not exists summary_up_to_message_id uuid;

alter table conversations
  add constraint if not exists conversations_summary_up_to_message_id_fkey
  foreign key (summary_up_to_message_id) references messages(id);
