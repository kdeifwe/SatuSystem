alter table messages add column if not exists send_delay_ms int;
alter table messages add column if not exists split_group_id uuid;
alter table messages add column if not exists split_part_index int;
