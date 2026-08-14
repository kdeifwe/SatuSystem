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
language plpgsql
security definer
as $function$
declare
  a record;
  mode text;
  last_embedding_change timestamptz;
  has_search_vector boolean;
begin
  has_search_vector := exists(
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'kb_chunks' and column_name = 'search_vector'
  );

  for a in select id, name from public.agents loop
    agent_id := a.id;
    agent_name := a.name;

    select count(*) into total_chunks from public.kb_chunks where agent_id = a.id;
    select count(*) into null_embedding_count from public.kb_chunks where agent_id = a.id and embedding is null;

    if has_search_vector then
      execute format('select count(*) from public.kb_chunks where agent_id = %L and search_vector is null', a.id) into null_search_vector_count;
    else
      null_search_vector_count := 0;
    end if;

    select t.embedding_provider into mode
    from (
      select embedding_provider, count(*) as c
      from public.kb_chunks
      where agent_id = a.id and embedding_provider is not null
      group by embedding_provider
      order by c desc
      limit 1
    ) t;

    if mode is null then
      embedding_provider_mismatch_count := 0;
    else
      select count(*) into embedding_provider_mismatch_count
      from public.kb_chunks
      where agent_id = a.id and (embedding_provider is null or embedding_provider <> mode);
    end if;

    select max(coalesce((metadata->>'embedding_updated_at')::timestamptz, created_at))
    into last_embedding_change
    from public.kb_chunks
    where agent_id = a.id and embedding is not null;

    if last_embedding_change is null then
      stale_semantic_links := 0;
    else
      select count(*) into stale_semantic_links
      from public.kb_chunk_links l
      where l.agent_id = a.id and l.link_type = 'semantic' and l.created_at < last_embedding_change;
    end if;

    return next;
  end loop;
end;
$function$;
