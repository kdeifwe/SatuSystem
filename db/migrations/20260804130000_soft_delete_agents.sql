-- Soft-delete agents while keeping their history and related data intact.

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

DROP POLICY IF EXISTS "org members can select agents" ON public.agents;
CREATE POLICY "org members can select agents"
  ON public.agents FOR SELECT
  USING (
    org_id IN (
      SELECT org_id
      FROM public.org_members
      WHERE user_id = auth.uid()
    )
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS "org members can select kb_sources" ON public.kb_sources;
CREATE POLICY "org members can select kb_sources"
  ON public.kb_sources FOR SELECT
  USING (
    agent_id IN (
      SELECT id
      FROM public.agents
      WHERE org_id IN (
        SELECT org_id
        FROM public.org_members
        WHERE user_id = auth.uid()
      )
      AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "org members can select kb_chunks" ON public.kb_chunks;
CREATE POLICY "org members can select kb_chunks"
  ON public.kb_chunks FOR SELECT
  USING (
    agent_id IN (
      SELECT id
      FROM public.agents
      WHERE org_id IN (
        SELECT org_id
        FROM public.org_members
        WHERE user_id = auth.uid()
      )
      AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "org members can select agent_versions" ON public.agent_versions;
CREATE POLICY "org members can select agent_versions"
  ON public.agent_versions FOR SELECT
  USING (
    agent_id IN (
      SELECT id
      FROM public.agents
      WHERE org_id IN (
        SELECT org_id
        FROM public.org_members
        WHERE user_id = auth.uid()
      )
      AND deleted_at IS NULL
    )
  );
