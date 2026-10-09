CREATE TABLE IF NOT EXISTS public.calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  google_email text,
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'needs_reauth')),
  refresh_token_encrypted text NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_connections_org_id
  ON public.calendar_connections (org_id);

CREATE INDEX IF NOT EXISTS idx_calendar_connections_agent_id
  ON public.calendar_connections (agent_id);

ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;
