-- add inline_in_prompt flag to kb_sources

alter table kb_sources
  add column if not exists inline_in_prompt boolean default false not null;
