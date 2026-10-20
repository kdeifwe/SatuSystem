-- Причина отказа для потерянных лидов (status = 'lost').
alter table leads add column if not exists lost_reason text;
alter table leads add column if not exists lost_note text;
alter table leads add column if not exists lost_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_lost_reason_check') then
    alter table leads
      add constraint leads_lost_reason_check
      check (lost_reason is null or lost_reason in ('price', 'timing', 'competitor', 'postponed', 'wrong_product', 'no_response', 'other'));
  end if;
end $$;

create index if not exists idx_leads_lost_reason
  on leads (org_id, lost_at desc)
  where status = 'lost';
