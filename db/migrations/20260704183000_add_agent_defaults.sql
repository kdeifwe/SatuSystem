alter table organizations
  add column if not exists agent_defaults jsonb default '{}'::jsonb;

update organizations
set agent_defaults = '{}'::jsonb
where agent_defaults is null;
