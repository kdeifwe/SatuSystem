-- Fix scenario_runs DELETE policy to reference scenarios instead of leads.

drop policy if exists "org members can delete scenario_runs" on scenario_runs;
create policy "org members can delete scenario_runs" on scenario_runs for delete
  using (scenario_id in (select id from scenarios where org_id in (select org_id from org_members where user_id = auth.uid())));
