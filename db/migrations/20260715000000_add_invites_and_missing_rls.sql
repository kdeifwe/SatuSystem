-- Add invites table and missing RLS policies for Phase 0 hardening

create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  email text not null,
  token text not null unique,
  role text not null check (role in ('owner','admin','member')),
  status text not null default 'pending' check (status in ('pending','sent','accepted','revoked')),
  created_by uuid references profiles(id),
  sent_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz default now()
);

alter table invites enable row level security;
create policy "org members can select invites" on invites for select
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can insert invites" on invites for insert
  with check (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can update invites" on invites for update
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can delete invites" on invites for delete
  using (org_id in (select org_id from org_members where user_id = auth.uid()));

alter table agent_versions enable row level security;
create policy "org members can select agent_versions" on agent_versions for select
  using (agent_id in (select id from agents where org_id in (select org_id from org_members where user_id = auth.uid())));
create policy "org members can insert agent_versions" on agent_versions for insert
  with check (agent_id in (select id from agents where org_id in (select org_id from org_members where user_id = auth.uid())));
create policy "org members can update agent_versions" on agent_versions for update
  using (agent_id in (select id from agents where org_id in (select org_id from org_members where user_id = auth.uid())));
create policy "org members can delete agent_versions" on agent_versions for delete
  using (agent_id in (select id from agents where org_id in (select org_id from org_members where user_id = auth.uid())));

alter table lead_notes enable row level security;
create policy "org members can select lead_notes" on lead_notes for select
  using (lead_id in (select id from leads where org_id in (select org_id from org_members where user_id = auth.uid())));
create policy "org members can insert lead_notes" on lead_notes for insert
  with check (lead_id in (select id from leads where org_id in (select org_id from org_members where user_id = auth.uid())));
create policy "org members can update lead_notes" on lead_notes for update
  using (lead_id in (select id from leads where org_id in (select org_id from org_members where user_id = auth.uid())));
create policy "org members can delete lead_notes" on lead_notes for delete
  using (lead_id in (select id from leads where org_id in (select org_id from org_members where user_id = auth.uid())));

alter table conversations enable row level security;
create policy "org members can select conversations" on conversations for select
  using (lead_id in (select id from leads where org_id in (select org_id from org_members where user_id = auth.uid())));
create policy "org members can insert conversations" on conversations for insert
  with check (lead_id in (select id from leads where org_id in (select org_id from org_members where user_id = auth.uid())));
create policy "org members can update conversations" on conversations for update
  using (lead_id in (select id from leads where org_id in (select org_id from org_members where user_id = auth.uid())));
create policy "org members can delete conversations" on conversations for delete
  using (lead_id in (select id from leads where org_id in (select org_id from org_members where user_id = auth.uid())));

alter table messages enable row level security;
create policy "org members can select messages" on messages for select
  using (
    conversation_id in (
      select id from conversations where lead_id in (
        select id from leads where org_id in (select org_id from org_members where user_id = auth.uid())
      )
    )
  );
create policy "org members can insert messages" on messages for insert
  with check (
    conversation_id in (
      select id from conversations where lead_id in (
        select id from leads where org_id in (select org_id from org_members where user_id = auth.uid())
      )
    )
  );
create policy "org members can update messages" on messages for update
  using (
    conversation_id in (
      select id from conversations where lead_id in (
        select id from leads where org_id in (select org_id from org_members where user_id = auth.uid())
      )
    )
  );
create policy "org members can delete messages" on messages for delete
  using (
    conversation_id in (
      select id from conversations where lead_id in (
        select id from leads where org_id in (select org_id from org_members where user_id = auth.uid())
      )
    )
  );

alter table scenario_runs enable row level security;
create policy "org members can select scenario_runs" on scenario_runs for select
  using (scenario_id in (select id from scenarios where org_id in (select org_id from org_members where user_id = auth.uid())));
create policy "org members can insert scenario_runs" on scenario_runs for insert
  with check (scenario_id in (select id from scenarios where org_id in (select org_id from org_members where user_id = auth.uid())));
create policy "org members can update scenario_runs" on scenario_runs for update
  using (scenario_id in (select id from scenarios where org_id in (select org_id from org_members where user_id = auth.uid())));
create policy "org members can delete scenario_runs" on scenario_runs for delete
  using (scenario_id in (select id from scenarios where org_id in (select org_id from org_members where user_id = auth.uid())));

alter table ai_call_logs enable row level security;
create policy "org members can select ai_call_logs" on ai_call_logs for select
  using (
    conversation_id in (
      select id from conversations where lead_id in (
        select id from leads where org_id in (select org_id from org_members where user_id = auth.uid())
      )
    )
  );
create policy "org members can insert ai_call_logs" on ai_call_logs for insert
  with check (
    conversation_id in (
      select id from conversations where lead_id in (
        select id from leads where org_id in (select org_id from org_members where user_id = auth.uid())
      )
    )
  );
create policy "org members can update ai_call_logs" on ai_call_logs for update
  using (
    conversation_id in (
      select id from conversations where lead_id in (
        select id from leads where org_id in (select org_id from org_members where user_id = auth.uid())
      )
    )
  );
create policy "org members can delete ai_call_logs" on ai_call_logs for delete
  using (
    conversation_id in (
      select id from conversations where lead_id in (
        select id from leads where org_id in (select org_id from org_members where user_id = auth.uid())
      )
    )
  );

create index if not exists org_members_user_id_idx on org_members(user_id);
