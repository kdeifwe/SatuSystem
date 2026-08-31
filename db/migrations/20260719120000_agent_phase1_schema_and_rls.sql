alter table agents add column if not exists goal_status text default 'active';
alter table agents add column if not exists undefined_close_statuses jsonb default '[]'::jsonb;
alter table agents add column if not exists response_wait_hours integer default 24;
alter table agents add column if not exists updated_at timestamptz default now();

update agents
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

drop policy if exists "org members can update agents" on agents;
drop policy if exists "org members can delete agents" on agents;

create policy "org members can update agents" on agents for update
  using (
    org_id in (
      select org_id
      from org_members
      where user_id = auth.uid()
        and role in ('owner', 'admin')
    )
  )
  with check (
    org_id in (
      select org_id
      from org_members
      where user_id = auth.uid()
        and role in ('owner', 'admin')
    )
  );

create policy "org members can delete agents" on agents for delete
  using (
    org_id in (
      select org_id
      from org_members
      where user_id = auth.uid()
        and role in ('owner', 'admin')
    )
  );
