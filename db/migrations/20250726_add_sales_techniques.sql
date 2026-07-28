create extension if not exists pgcrypto;
create extension if not exists vector;

create table if not exists niche_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  traits jsonb not null default '{}'::jsonb,
  preferred_methodologies text[] not null default '{}'::text[],
  system_prompt_addon text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on column niche_profiles.name is 'Display name of the niche profile (up to 120 characters).';
comment on column niche_profiles.slug is 'URL-friendly niche identifier (up to 100 characters).';
comment on column niche_profiles.traits is 'Structured niche characteristics such as decision type, sales cycle, and price sensitivity.';
comment on column niche_profiles.preferred_methodologies is 'Preferred sales methodologies for the niche (up to 20 entries).';
comment on column niche_profiles.system_prompt_addon is 'Short niche-specific AI instructions (up to 200 characters).';

create table if not exists sales_techniques (
  id uuid primary key default gen_random_uuid(),
  methodology text not null,
  technique_name text not null,
  niche_tags text[] not null default '{}'::text[],
  trigger_embedding vector(768),
  trigger_text text not null,
  script_template text not null,
  examples jsonb not null default '[]'::jsonb,
  difficulty text check (difficulty in ('beginner', 'intermediate', 'advanced')),
  tokens_estimate int default 50,
  is_active boolean default true,
  created_at timestamptz default now()
);

comment on column sales_techniques.methodology is 'Sales methodology family such as SPIN, FAB, or Challenger.';
comment on column sales_techniques.technique_name is 'Human-readable technique name (up to 120 characters).';
comment on column sales_techniques.niche_tags is 'Niche labels for retrieval such as b2c or high_involvement.';
comment on column sales_techniques.trigger_text is 'Human-readable trigger description (up to 500 characters).';
comment on column sales_techniques.script_template is 'Reusable script pattern for the technique (up to 2000 characters).';
comment on column sales_techniques.examples is 'Example mappings of niche slug to example text for different niches.';

create table if not exists conversation_examples (
  id uuid primary key default gen_random_uuid(),
  niche_id uuid references niche_profiles(id) on delete cascade,
  technique_id uuid references sales_techniques(id) on delete cascade,
  situation_embedding vector(768),
  situation_text text not null,
  agent_reply text not null,
  outcome text check (outcome in ('lead_converted', 'appointment_set', 'objection_handled', 'follow_up_scheduled', 'lost')),
  channel text,
  created_at timestamptz default now()
);

comment on column conversation_examples.situation_text is 'Conversation situation summary (up to 1000 characters).';
comment on column conversation_examples.agent_reply is 'The agent response that was used in the example (up to 2000 characters).';
comment on column conversation_examples.channel is 'Channel label such as whatsapp, telegram, instagram, or web.';

create table if not exists agent_niche_assignment (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  niche_id uuid references niche_profiles(id) on delete cascade,
  custom_methodologies text[] default '{}'::text[],
  custom_prompt_addon text,
  is_active boolean default true,
  created_at timestamptz default now()
);

comment on column agent_niche_assignment.custom_methodologies is 'Optional override for niche methodologies (up to 20 entries).';
comment on column agent_niche_assignment.custom_prompt_addon is 'Optional prompt override for the agent (up to 200 characters).';

create index if not exists sales_techniques_niche_tags_gin_idx
  on sales_techniques using gin (niche_tags);

create index if not exists niche_profiles_traits_gin_idx
  on niche_profiles using gin (traits);

create index if not exists sales_techniques_trigger_embedding_ivfflat_idx
  on sales_techniques using ivfflat (trigger_embedding vector_cosine_ops) with (lists = 100);

create index if not exists conversation_examples_situation_embedding_ivfflat_idx
  on conversation_examples using ivfflat (situation_embedding vector_cosine_ops) with (lists = 100);

alter table niche_profiles enable row level security;
alter table sales_techniques enable row level security;
alter table conversation_examples enable row level security;
alter table agent_niche_assignment enable row level security;

create policy "authenticated users can select niche profiles"
  on niche_profiles for select
  using (auth.role() = 'authenticated' or auth.role() = 'service_role');

create policy "service role can insert niche profiles"
  on niche_profiles for insert
  with check (auth.role() = 'service_role');

create policy "service role can update niche profiles"
  on niche_profiles for update
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "authenticated users can select sales techniques"
  on sales_techniques for select
  using (auth.role() = 'authenticated' or auth.role() = 'service_role');

create policy "service role can insert sales techniques"
  on sales_techniques for insert
  with check (auth.role() = 'service_role');

create policy "service role can update sales techniques"
  on sales_techniques for update
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "authenticated users can select conversation examples"
  on conversation_examples for select
  using (auth.role() = 'authenticated' or auth.role() = 'service_role');

create policy "service role can insert conversation examples"
  on conversation_examples for insert
  with check (auth.role() = 'service_role');

create policy "service role can update conversation examples"
  on conversation_examples for update
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "service role can insert agent niche assignments"
  on agent_niche_assignment for insert
  with check (auth.role() = 'service_role');

create policy "service role can update agent niche assignments"
  on agent_niche_assignment for update
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "organization members can select agent niche assignments"
  on agent_niche_assignment for select
  using (
    exists (
      select 1
      from agents a
      join org_members om on om.org_id = a.org_id
      where a.id = agent_niche_assignment.agent_id
        and om.user_id = auth.uid()
    )
  );

create or replace function match_sales_techniques(
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  filter_niche_tags text[] default '{}'::text[],
  filter_methodologies text[] default '{}'::text[]
)
returns table (
  id uuid,
  methodology text,
  technique_name text,
  trigger_text text,
  script_template text,
  examples jsonb,
  difficulty text,
  tokens_estimate int,
  similarity float
)
language sql
stable
as $$
  select
    st.id,
    st.methodology,
    st.technique_name,
    st.trigger_text,
    st.script_template,
    st.examples,
    st.difficulty,
    st.tokens_estimate,
    1 - (st.trigger_embedding <=> query_embedding) as similarity
  from sales_techniques st
  where st.is_active = true
    and st.trigger_embedding is not null
    and 1 - (st.trigger_embedding <=> query_embedding) > match_threshold
    and (filter_niche_tags = '{}'::text[] or st.niche_tags && filter_niche_tags)
    and (filter_methodologies = '{}'::text[] or st.methodology = any(filter_methodologies))
  order by st.trigger_embedding <=> query_embedding
  limit match_count;
$$;

create or replace function match_conversation_examples(
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  filter_niche_id uuid default null
)
returns table (
  id uuid,
  niche_id uuid,
  technique_id uuid,
  situation_text text,
  agent_reply text,
  outcome text,
  channel text,
  similarity float
)
language sql
stable
as $$
  select
    ce.id,
    ce.niche_id,
    ce.technique_id,
    ce.situation_text,
    ce.agent_reply,
    ce.outcome,
    ce.channel,
    1 - (ce.situation_embedding <=> query_embedding) as similarity
  from conversation_examples ce
  where ce.situation_embedding is not null
    and 1 - (ce.situation_embedding <=> query_embedding) > match_threshold
    and (filter_niche_id is null or ce.niche_id = filter_niche_id)
  order by ce.situation_embedding <=> query_embedding
  limit match_count;
$$;

-- Ensure unique technique per methodology for idempotent seeding
create unique index if not exists sales_techniques_methodology_name_idx
  on sales_techniques (methodology, technique_name);

-- Ensure only one active niche assignment per agent
create unique index if not exists agent_niche_assignment_active_idx
  on agent_niche_assignment (agent_id)
  where is_active = true;
