do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'kaspi_invoices_status_check'
      and conrelid = 'public.kaspi_invoices'::regclass
  ) then
    alter table public.kaspi_invoices
      add constraint kaspi_invoices_status_check
      check (status in ('pending', 'paid', 'failed', 'expired'));
  end if;
end
$$;
