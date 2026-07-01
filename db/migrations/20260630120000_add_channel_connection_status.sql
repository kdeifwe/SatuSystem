alter table channels
  add column if not exists connection_status text default 'disconnected';

update channels
set connection_status = case
  when is_active then 'connected'
  else 'disconnected'
end
where connection_status is null;

alter table channels
  alter column connection_status set default 'disconnected';
