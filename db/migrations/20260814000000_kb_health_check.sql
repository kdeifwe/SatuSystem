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
  v_mode text;
  v_last_embedding_change timestamptz;
  v_has_search_vector boolean;
  v_agent_id uuid;
  v_agent_name text;
  v_total_chunks integer;
  v_null_embedding_count integer;
  v_null_search_vector_count integer;
  v_embedding_provider_mismatch_count integer;
  v_stale_semantic_links integer;
begin
  v_has_search_vector := exists(
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'kb_chunks' and column_name = 'search_vector'
  );

  for a in select id, name from public.agents loop
    v_agent_id := a.id;
    v_agent_name := a.name;

    select count(*) into v_total_chunks from public.kb_chunks where public.kb_chunks.agent_id = v_agent_id;
    select count(*) into v_null_embedding_count from public.kb_chunks where public.kb_chunks.agent_id = v_agent_id and public.kb_chunks.embedding is null;

    if v_has_search_vector then
      execute format('select count(*) from public.kb_chunks where public.kb_chunks.agent_id = %L and search_vector is null', v_agent_id) into v_null_search_vector_count;
    else
      v_null_search_vector_count := 0;
    end if;

    select t.embedding_provider into v_mode
    from (
      select embedding_provider, count(*) as c
      from public.kb_chunks
      where public.kb_chunks.agent_id = v_agent_id and public.kb_chunks.embedding_provider is not null
      group by embedding_provider
      order by c desc
      limit 1
    ) t;

    if v_mode is null then
      v_embedding_provider_mismatch_count := 0;
    else
      select count(*) into v_embedding_provider_mismatch_count
      from public.kb_chunks
      where public.kb_chunks.agent_id = v_agent_id and (public.kb_chunks.embedding_provider is null or public.kb_chunks.embedding_provider <> v_mode);
    end if;

    select max(coalesce((metadata->>'embedding_updated_at')::timestamptz, created_at))
    into v_last_embedding_change
    from public.kb_chunks
    where public.kb_chunks.agent_id = v_agent_id and public.kb_chunks.embedding is not null;

    if v_last_embedding_change is null then
      v_stale_semantic_links := 0;
    else
      select count(*) into v_stale_semantic_links
      from public.kb_chunk_links l
      where l.agent_id = v_agent_id and l.link_type = 'semantic' and l.created_at < v_last_embedding_change;
    end if;

    -- assign OUT variables before returning
    agent_id := v_agent_id;
    agent_name := v_agent_name;
    total_chunks := v_total_chunks;
    null_embedding_count := v_null_embedding_count;
    null_search_vector_count := v_null_search_vector_count;
    embedding_provider_mismatch_count := v_embedding_provider_mismatch_count;
    stale_semantic_links := v_stale_semantic_links;

    return next;
  end loop;
end;
$function$;
