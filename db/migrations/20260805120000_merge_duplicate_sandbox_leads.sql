-- Merge duplicate sandbox leads into a single canonical sandbox lead per agent
-- and normalize external_id to sandbox:<agentId>.

with sandbox_leads as (
  select
    id,
    external_id,
    regexp_replace(external_id, '^sandbox:([^:]+)(:.*)?$', 'sandbox:\1') as canonical_external_id,
    case when external_id = regexp_replace(external_id, '^sandbox:([^:]+)(:.*)?$', 'sandbox:\1') then true else false end as is_canonical,
    created_at
  from leads
  where external_id like 'sandbox:%'
),
canonical_target as (
  select
    canonical_external_id,
    coalesce(
      (min(id::text) filter (where is_canonical))::uuid,
      (
        select sl2.id
        from sandbox_leads sl2
        where sl2.canonical_external_id = sl.canonical_external_id
        order by sl2.created_at desc
        limit 1
      )
    ) as target_lead_id
  from sandbox_leads sl
  group by canonical_external_id
),
to_move as (
  select sl.*
  from sandbox_leads sl
  join canonical_target ct on sl.canonical_external_id = ct.canonical_external_id
  where sl.id <> ct.target_lead_id
)
update conversations c
set lead_id = ct.target_lead_id
from to_move tm
join canonical_target ct on tm.canonical_external_id = ct.canonical_external_id
where c.lead_id = tm.id;

delete from leads l
using to_move tm
where l.id = tm.id;

update leads l
set external_id = regexp_replace(l.external_id, '^sandbox:([^:]+):.*$', 'sandbox:\1')
from canonical_target ct
where l.id = ct.target_lead_id
  and l.external_id <> ct.canonical_external_id;
