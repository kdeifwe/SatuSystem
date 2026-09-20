-- 1. Recreate search_vector as language-agnostic (it was hardcoded to 'russian')
alter table public.kb_chunks drop column if exists search_vector;
alter table public.kb_chunks
  add column search_vector tsvector
  generated always as (to_tsvector('simple', coalesce(content, ''))) stored;

create index if not exists kb_chunks_search_vector_idx
  on public.kb_chunks using gin (search_vector);

-- 2. Search function: use 'simple' tsquery config instead of 'russian'
create or replace function public.search_knowledge_base(
  p_agent_id uuid,
  query_embedding vector,
  p_query_text text default null,
  match_count integer default 10,
  similarity_threshold double precision default 0.3
)
returns table(
  chunk_id uuid, source_id uuid, content text, similarity double precision,
  priority text, metadata jsonb, source_metadata jsonb
)
language sql stable as $function$
  with params as (
    select p_agent_id as agent_id, query_embedding as q_emb, p_query_text as q_text
  ),
  candidate as (
    select
      c.id as chunk_id, c.source_id, c.content,
      1 - (c.embedding <=> params.q_emb) as vector_similarity,
      case when params.q_text is not null and c.search_vector is not null
           then ts_rank(c.search_vector, websearch_to_tsquery('simple', params.q_text))
           else 0 end as text_rank,
      c.priority, c.metadata,
      s.metadata as source_metadata_raw, s.title as source_title
    from public.kb_chunks c
    join params on true
    left join public.kb_sources s on s.id = c.source_id
    where c.agent_id = params.agent_id and c.embedding is not null
  ),
  max_text as (select max(text_rank) as max_rank from candidate),
  scored as (
    select chunk_id, source_id, content, vector_similarity, text_rank, priority, metadata,
      coalesce(source_metadata_raw, jsonb_build_object('title', source_title)) as source_metadata,
      case when params.q_text is null then vector_similarity
        else (vector_similarity * 0.7) + ((case when max_text.max_rank is null or max_text.max_rank = 0 then 0 else (text_rank / max_text.max_rank) end) * 0.3)
      end as hybrid_score
    from candidate, params, max_text
  )
  select chunk_id, source_id, content, vector_similarity as similarity, priority, metadata, source_metadata
  from scored, params
  where vector_similarity::text <> 'NaN'
    and (
      (params.q_text is null and vector_similarity >= similarity_threshold)
      or (params.q_text is not null and (vector_similarity >= similarity_threshold or text_rank > 0))
    )
  order by hybrid_score desc nulls last
  limit match_count;
$function$;

-- Why 'simple' instead of a Kazakh dictionary:
-- Postgres does not ship a built-in Kazakh full-text config, and using 'russian' with stemming on Kazakh text hurts recall more than it helps.
-- 'simple' tokenizes without stemming, which is neutral across both Russian and Kazakh input and avoids systemically discriminating Kazakh queries.
