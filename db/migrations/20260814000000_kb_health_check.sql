-- kb_health_check.sql

create or replace function public.kb_health_check()
returns table(
  agent_id uuid,
  agent_name text,
  total_chunks integer,
  null_embedding_count integer,
  null_search_vector_count integer,
  embedding_provider_mismatch_count integer,
  stale_semantic_links integer
)
language sql
security definer
as $function$
  select
    a.id as agent_id,
    a.name as agent_name,
    coalesce((select count(*) from public.kb_chunks kc where kc.agent_id = a.id), 0) as total_chunks,
    coalesce((select count(*) from public.kb_chunks kc where kc.agent_id = a.id and kc.embedding is null), 0) as null_embedding_count,
    case when exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'kb_chunks' and column_name = 'search_vector')
      then coalesce((select count(*) from public.kb_chunks kc where kc.agent_id = a.id and kc.search_vector is null), 0)
      else 0 end as null_search_vector_count,
    -- embedding provider mismatch: count of chunks where provider is null or differs from the most common provider for the agent
    coalesce(
      (
        select count(*) from public.kb_chunks kc where kc.agent_id = a.id and (
          kc.embedding_provider is null or kc.embedding_provider <> (
            select embedding_provider from (
              select embedding_provider, count(*) as c from public.kb_chunks kc2 where kc2.agent_id = a.id and kc2.embedding_provider is not null group by embedding_provider order by c desc limit 1
            ) t
          )
        )
      ), 0
    ) as embedding_provider_mismatch_count,
    -- stale semantic links: count of semantic links older than last embedding change for the agent
    coalesce(
      (
        select case when last_change is null then 0 else (
          select count(*) from public.kb_chunk_links l where l.agent_id = a.id and l.link_type = 'semantic' and l.created_at < last_change
        ) end
        from (
          select max(coalesce((kc.metadata->>'embedding_updated_at')::timestamptz, kc.created_at)) as last_change
          from public.kb_chunks kc where kc.agent_id = a.id and kc.embedding is not null
        ) s
      ), 0
    ) as stale_semantic_links
  from public.agents a;
$function$;
