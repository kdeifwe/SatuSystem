-- Statistics module schema support without recreating existing tables
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS goal_status text,
  ADD COLUMN IF NOT EXISTS undefined_close_statuses text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS response_wait_hours numeric DEFAULT 24;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS campaign text;

CREATE TABLE IF NOT EXISTS lead_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  old_status text,
  new_status text,
  changed_at timestamptz DEFAULT now(),
  changed_by uuid REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS lead_status_history_lead_idx ON lead_status_history(lead_id, changed_at);
CREATE INDEX IF NOT EXISTS lead_status_history_new_status_idx ON lead_status_history(new_status, changed_at);

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS origin text DEFAULT 'conversation',
  ADD COLUMN IF NOT EXISTS operator_id uuid REFERENCES profiles(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'messages_origin_check'
      AND conrelid = 'public.messages'::regclass
  ) THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_origin_check
      CHECK (origin IN ('conversation', 'scenario', 'broadcast', 'followup'));
  END IF;
END $$;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS leads_org_created_idx ON leads(org_id, created_at);

CREATE OR REPLACE FUNCTION public.log_lead_status_change()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.lead_status_history (lead_id, old_status, new_status, changed_at, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, now(), auth.uid());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS lead_status_change_trigger ON public.leads;
CREATE TRIGGER lead_status_change_trigger
AFTER UPDATE OF status ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.log_lead_status_change();

ALTER TABLE public.lead_status_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'lead_status_history'
      AND policyname = 'lead_status_history_org_members_select'
  ) THEN
    CREATE POLICY lead_status_history_org_members_select
    ON public.lead_status_history
    FOR SELECT
    USING (
      lead_id IN (
        SELECT id
        FROM public.leads
        WHERE org_id IN (
          SELECT org_id
          FROM public.org_members
          WHERE user_id = auth.uid()
        )
      )
    );
  END IF;
END $$;
