-- init.sql

create extension if not exists vector;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text default 'Asia/Almaty',
  currency text default 'KZT',
  branding jsonb default '{}',
  created_at timestamptz default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz default now()
);

create table if not exists org_members (
  org_id uuid references organizations(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  role text not null check (role in ('owner','admin','member')),
  section_permissions jsonb default '{}',
  primary key (org_id, user_id)
);

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  name text not null,
  role text,
  goal text,
  tone_of_voice text,
  human_communication_style text,
  communication_rules text,
  knowledge_base_principles text,
  dialogue_flow jsonb,
  general_capabilities jsonb,
  model text default 'gemini-3.5-flash',
  temperature numeric default 0.7,
  top_p numeric default 0.9,
  system_prompt_compiled text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists agent_versions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references agents(id) on delete cascade,
  snapshot jsonb not null,
  change_note text,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

create table if not exists kb_sources (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references agents(id) on delete cascade,
  type text check (type in ('file','website','qa','manual','google_docs','google_sheets')),
  title text,
  raw_content text,
  status text default 'pending',
  inline_in_prompt boolean default false not null,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

create table if not exists kb_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references kb_sources(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  content text not null,
  embedding vector(3072),
  metadata jsonb default '{}',
  created_at timestamptz default now()
);
alter table kb_chunks add column if not exists embedding vector(3072);
create index if not exists kb_chunks_embedding_idx on kb_chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  type text check (type in ('whatsapp','telegram')),
  credentials jsonb not null,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  channel_id uuid references channels(id),
  external_id text,
  name text,
  status text default 'new',
  assigned_to uuid references profiles(id),
  ai_enabled boolean default true,
  tags text[] default '{}',
  attributes jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table leads add column if not exists external_id text;
create unique index if not exists leads_channel_external_idx on leads(channel_id, external_id);

create table if not exists lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  author_id uuid references profiles(id),
  note text,
  created_at timestamptz default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  agent_id uuid references agents(id),
  started_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  sender text check (sender in ('user','ai','operator','system')),
  content text,
  media_url text,
  tool_calls jsonb,
  external_message_id text,
  created_at timestamptz default now()
);
alter table messages add column if not exists external_message_id text;
create unique index if not exists messages_external_idx on messages(external_message_id)
  where external_message_id is not null;

create table if not exists scenarios (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  name text,
  trigger jsonb not null,
  actions jsonb not null,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists scenario_runs (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid references scenarios(id) on delete cascade,
  lead_id uuid references leads(id),
  result text,
  ran_at timestamptz default now()
);

create table if not exists broadcasts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  channel_type text check (channel_type in ('whatsapp','telegram')),
  template jsonb,
  audience_filter jsonb,
  status text default 'draft',
  created_at timestamptz default now()
);

create table if not exists broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid references broadcasts(id) on delete cascade,
  lead_id uuid references leads(id),
  status text default 'pending',
  sent_at timestamptz
);

create table if not exists custom_tools (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  name text,
  type text check (type in ('rest','mcp')),
  config jsonb not null,
  created_at timestamptz default now()
);

create table if not exists ai_call_logs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id),
  request jsonb,
  response jsonb,
  tokens_input int,
  tokens_output int,
  latency_ms int,
  created_at timestamptz default now()
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  provider text check (provider in ('paddle','kzt_provider')),
  plan text,
  status text,
  renews_at timestamptz,
  created_at timestamptz default now()
);

alter table organizations enable row level security;
create policy "org members can select organizations"
  on organizations for select
  using (
    id in (select org_id from org_members where user_id = auth.uid())
  );
create policy "authenticated can insert organizations"
  on organizations for insert
  with check (auth.uid() is not null);
create policy "org members can update organizations"
  on organizations for update
  using (
    id in (select org_id from org_members where user_id = auth.uid())
  );
create policy "org members can delete organizations"
  on organizations for delete
  using (
    id in (select org_id from org_members where user_id = auth.uid())
  );

alter table profiles enable row level security;
create policy "profile owner select" on profiles for select
  using (id = auth.uid());
create policy "profile owner insert" on profiles for insert
  with check (id = auth.uid());
create policy "profile owner update" on profiles for update
  using (id = auth.uid());

alter table org_members enable row level security;
create policy "org member select" on org_members for select
  using (user_id = auth.uid());
create policy "org member insert" on org_members for insert
  with check (user_id = auth.uid());
create policy "org member update" on org_members for update
  using (user_id = auth.uid());
create policy "org member delete" on org_members for delete
  using (user_id = auth.uid());

alter table agents enable row level security;
create policy "org members can select agents" on agents for select
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can insert agents" on agents for insert
  with check (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can update agents" on agents for update
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can delete agents" on agents for delete
  using (org_id in (select org_id from org_members where user_id = auth.uid()));

alter table kb_sources enable row level security;
create policy "org members can select kb_sources" on kb_sources for select
  using (agent_id in (select id from agents where org_id in (select org_id from org_members where user_id = auth.uid())));
create policy "org members can insert kb_sources" on kb_sources for insert
  with check (agent_id in (select id from agents where org_id in (select org_id from org_members where user_id = auth.uid())));
create policy "org members can update kb_sources" on kb_sources for update
  using (agent_id in (select id from agents where org_id in (select org_id from org_members where user_id = auth.uid())));
create policy "org members can delete kb_sources" on kb_sources for delete
  using (agent_id in (select id from agents where org_id in (select org_id from org_members where user_id = auth.uid())));

alter table kb_chunks enable row level security;
create policy "org members can select kb_chunks" on kb_chunks for select
  using (agent_id in (select id from agents where org_id in (select org_id from org_members where user_id = auth.uid())));
create policy "org members can insert kb_chunks" on kb_chunks for insert
  with check (agent_id in (select id from agents where org_id in (select org_id from org_members where user_id = auth.uid())));
create policy "org members can update kb_chunks" on kb_chunks for update
  using (agent_id in (select id from agents where org_id in (select org_id from org_members where user_id = auth.uid())));
create policy "org members can delete kb_chunks" on kb_chunks for delete
  using (agent_id in (select id from agents where org_id in (select org_id from org_members where user_id = auth.uid())));

alter table channels enable row level security;
create policy "org members can select channels" on channels for select
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can insert channels" on channels for insert
  with check (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can update channels" on channels for update
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can delete channels" on channels for delete
  using (org_id in (select org_id from org_members where user_id = auth.uid()));

alter table leads enable row level security;
create policy "org members can select leads" on leads for select
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can insert leads" on leads for insert
  with check (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can update leads" on leads for update
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can delete leads" on leads for delete
  using (org_id in (select org_id from org_members where user_id = auth.uid()));

alter table scenarios enable row level security;
create policy "org members can select scenarios" on scenarios for select
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can insert scenarios" on scenarios for insert
  with check (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can update scenarios" on scenarios for update
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can delete scenarios" on scenarios for delete
  using (org_id in (select org_id from org_members where user_id = auth.uid()));

alter table broadcasts enable row level security;
create policy "org members can select broadcasts" on broadcasts for select
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can insert broadcasts" on broadcasts for insert
  with check (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can update broadcasts" on broadcasts for update
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can delete broadcasts" on broadcasts for delete
  using (org_id in (select org_id from org_members where user_id = auth.uid()));

alter table broadcast_recipients enable row level security;
create policy "org members can select broadcast_recipients" on broadcast_recipients for select
  using (broadcast_id in (select id from broadcasts where org_id in (select org_id from org_members where user_id = auth.uid())));
create policy "org members can insert broadcast_recipients" on broadcast_recipients for insert
  with check (broadcast_id in (select id from broadcasts where org_id in (select org_id from org_members where user_id = auth.uid())));
create policy "org members can update broadcast_recipients" on broadcast_recipients for update
  using (broadcast_id in (select id from broadcasts where org_id in (select org_id from org_members where user_id = auth.uid())));
create policy "org members can delete broadcast_recipients" on broadcast_recipients for delete
  using (broadcast_id in (select id from broadcasts where org_id in (select org_id from org_members where user_id = auth.uid())));

alter table custom_tools enable row level security;
create policy "org members can select custom_tools" on custom_tools for select
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can insert custom_tools" on custom_tools for insert
  with check (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can update custom_tools" on custom_tools for update
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can delete custom_tools" on custom_tools for delete
  using (org_id in (select org_id from org_members where user_id = auth.uid()));

alter table subscriptions enable row level security;
create policy "org members can select subscriptions" on subscriptions for select
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can insert subscriptions" on subscriptions for insert
  with check (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can update subscriptions" on subscriptions for update
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
create policy "org members can delete subscriptions" on subscriptions for delete
  using (org_id in (select org_id from org_members where user_id = auth.uid()));
