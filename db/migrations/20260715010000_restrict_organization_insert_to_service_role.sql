-- Restrict organization creation to service-role only.

drop policy if exists "authenticated can insert organizations" on organizations;
create policy "service role can insert organizations" on organizations for insert
  with check (auth.role() = 'service_role');
