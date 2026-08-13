-- baseline_hybrid_search_functions.sql

create table if not exists public.kb_chunk_links (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references agents(id) on delete cascade,
  chunk_id uuid references kb_chunks(id) on delete cascade,
  related_chunk_id uuid references kb_chunks(id) on delete cascade,
  link_type text not null default 'semantic'::text check (link_type = any (array['semantic'::text, 'manual'::text, 'same_source'::text])),
  similarity numeric,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  check (chunk_id <> related_chunk_id)
);

create unique index if not exists kb_chunk_links_pair_idx on public.kb_chunk_links using btree (chunk_id, related_chunk_id, link_type);
create index if not exists kb_chunk_links_chunk_idx on public.kb_chunk_links using btree (chunk_id);
create index if not exists kb_chunk_links_related_idx on public.kb_chunk_links using btree (related_chunk_id);

alter table public.kb_chunk_links enable row level security;

-- Ensure policies are created deterministically: drop if exists, then create.
drop policy if exists "org members manage manual links of their agents" on public.kb_chunk_links;
create policy "org members manage manual links of their agents"
  on public.kb_chunk_links
  as permissive
  for all
  to public
  using (
    (link_type = 'manual'::text)
    and (agent_id in (
      select a.id
      from agents a
      join org_members om on (om.org_id = a.org_id)
      where (om.user_id = auth.uid())
    ))
  )
  with check (
    (link_type = 'manual'::text)
    and (agent_id in (
      select a.id
      from agents a
      join org_members om on (om.org_id = a.org_id)
      where (om.user_id = auth.uid())
    ))
  );

drop policy if exists "org members see links of their agents" on public.kb_chunk_links;
create policy "org members see links of their agents"
  on public.kb_chunk_links
  as permissive
  for select
  to public
  using (
    agent_id in (
      select a.id
      from agents a
      join org_members om on (om.org_id = a.org_id)
      where (om.user_id = auth.uid())
    )
  );

create or replace function public.search_knowledge_base(
  p_agent_id uuid,
  query_embedding vector,
  p_query_text text default null,
  match_count integer default 10,
  similarity_threshold double precision default 0.3
)
returns table(
  chunk_id uuid,
  source_id uuid,
  content text,
  similarity double precision,
  priority text,
  metadata jsonb,
  source_metadata jsonb
)
language sql
stable
as $function$
  with params as (
    select p_agent_id as agent_id, query_embedding as q_emb, p_query_text as q_text
  ),
  candidate as (
    select
      c.id as chunk_id,
      c.source_id,
      c.content,
      1 - (c.embedding <=> params.q_emb) as vector_similarity,
      case when params.q_text is not null and c.search_vector is not null
           then ts_rank(c.search_vector, websearch_to_tsquery('russian', params.q_text))
           else 0 end as text_rank,
      c.priority,
      c.metadata,
      s.metadata as source_metadata_raw,
      s.title as source_title
    from public.kb_chunks c
    join params on true
    left join public.kb_sources s on s.id = c.source_id
    where c.agent_id = params.agent_id
      and c.embedding is not null
  ),
  max_text as (
    select max(text_rank) as max_rank from candidate
  ),
  scored as (
    select
      chunk_id,
      source_id,
      content,
      vector_similarity,
      text_rank,
      priority,
      metadata,
      coalesce(source_metadata_raw, jsonb_build_object('title', source_title)) as source_metadata,
      case
        when params.q_text is null then vector_similarity
        else (
          -- weights are heuristic (0.7 vector / 0.3 text)
          (vector_similarity * 0.7) + ((case when max_text.max_rank is null or max_text.max_rank = 0 then 0 else (text_rank / max_text.max_rank) end) * 0.3)
        )
      end as hybrid_score
    from candidate, params, max_text
  )
  select
    chunk_id,
    source_id,
    content,
    -- keep `similarity` as vector similarity for backward compatibility
    vector_similarity as similarity,
    priority,
    metadata,
    source_metadata
  from scored, params
  where
    -- exclude non-finite similarity results that can sort unpredictably
    vector_similarity::text <> 'NaN'
    and (
      (
        params.q_text is null
        and vector_similarity >= similarity_threshold
      )
      or (
        params.q_text is not null
        and (vector_similarity >= similarity_threshold or text_rank > 0)
      )
    )
  order by hybrid_score desc NULLS LAST
  limit match_count;
$function$;

create or replace function public.get_linked_kb_chunks(p_chunk_ids uuid[])
returns table(
  id uuid,
  content text,
  priority text,
  metadata jsonb,
  link_type text,
  similarity numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select distinct on (kc.id)
    kc.id, kc.content, kc.priority, kc.metadata, l.link_type, l.similarity
  from kb_chunk_links l
  join kb_chunks kc on kc.id = case
    when l.chunk_id = any(p_chunk_ids) then l.related_chunk_id
    else l.chunk_id
  end
  where (l.chunk_id = any(p_chunk_ids) or l.related_chunk_id = any(p_chunk_ids))
    and kc.id <> all(p_chunk_ids)
  order by kc.id, l.similarity desc nulls last;
$function$;

create or replace function public.refresh_kb_chunk_links(
  p_agent_id uuid,
  p_top_k integer default 3,
  p_min_similarity numeric default 0.75
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  delete from kb_chunk_links where agent_id = p_agent_id and link_type = 'semantic';

  insert into kb_chunk_links (agent_id, chunk_id, related_chunk_id, link_type, similarity)
  select p_agent_id, c.id, n.id, 'semantic', n.sim
  from kb_chunks c
  cross join lateral (
    select c2.id, 1 - (c.embedding <=> c2.embedding) as sim
    from kb_chunks c2
    where c2.agent_id = p_agent_id and c2.id <> c.id and c2.embedding is not null
    order by c.embedding <=> c2.embedding
    limit p_top_k
  ) n
  where c.agent_id = p_agent_id and c.embedding is not null and n.sim >= p_min_similarity;

  insert into kb_chunk_links (agent_id, chunk_id, related_chunk_id, link_type)
  select distinct p_agent_id, a.id, b.id, 'same_source'
  from kb_chunks a
  join kb_chunks b on b.source_id = a.source_id and b.id <> a.id
    and b.chunk_index is not null and a.chunk_index is not null
    and abs(b.chunk_index - a.chunk_index) = 1
  where a.agent_id = p_agent_id
  on conflict (chunk_id, related_chunk_id, link_type) do nothing;
end;
$function$;
