-- Create function to return embedding provider counts per agent

create or replace function public.get_embedding_providers_for_agent(p_agent_id uuid)
returns table(provider text, count bigint)
language sql
security definer
set search_path to 'public'
as $$
  select metadata->>'embedding_provider' as provider, count(*)
  from kb_chunks
  where agent_id = p_agent_id
  group by 1;
$$;

-- Grant execute so the admin/service role can call it via RPC
grant execute on function public.get_embedding_providers_for_agent(uuid) to service_role;
