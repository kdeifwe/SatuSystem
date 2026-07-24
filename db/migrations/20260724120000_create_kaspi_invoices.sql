create extension if not exists pgcrypto;

create table if not exists kaspi_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  lead_id uuid references leads(id),
  conversation_id uuid references conversations(id),
  kaspi_invoice_id text,
  phone text not null,
  amount numeric not null,
  comment text,
  status text default 'pending',
  created_by text check (created_by in ('ai','operator')),
  error_message text,
  created_at timestamptz default now(),
  paid_at timestamptz
);

create unique index if not exists kaspi_invoices_kaspi_id_idx
  on kaspi_invoices(kaspi_invoice_id) where kaspi_invoice_id is not null;

alter table kaspi_invoices enable row level security;

create policy "org members see only their org kaspi invoices"
  on kaspi_invoices for select
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can insert kaspi invoices"
  on kaspi_invoices for insert
  with check (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can update kaspi invoices"
  on kaspi_invoices for update
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
