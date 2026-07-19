-- Final explicit invite insert policy: owners can invite anyone, admins can invite only members.

drop policy if exists "org members can insert invites" on invites;
create policy "org members can insert invites" on invites for insert
with check (
  (
    exists (
      select 1
      from org_members
      where user_id = auth.uid()
        and org_id = invites.org_id
        and role = 'owner'
    )
  )
  or (
    exists (
      select 1
      from org_members
      where user_id = auth.uid()
        and org_id = invites.org_id
        and role = 'admin'
    )
    and invites.role = 'member'
  )
);
