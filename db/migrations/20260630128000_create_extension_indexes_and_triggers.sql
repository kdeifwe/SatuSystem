create or replace function set_extension_settings_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists extension_settings_set_updated_at on extension_settings;
create trigger extension_settings_set_updated_at
before update on extension_settings
for each row
execute function set_extension_settings_updated_at();

create index if not exists extension_settings_agent_idx on extension_settings(agent_id);
