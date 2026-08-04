-- Make agent deletion cascade to all conversation-linked data, while keeping agent deletion restricted to owner/admin roles.

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_agent_id_fkey;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_conversation_id_fkey;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_conversation_id_fkey
  FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF to_regclass('public.ai_call_logs') IS NOT NULL THEN
    ALTER TABLE public.ai_call_logs
      DROP CONSTRAINT IF EXISTS ai_call_logs_conversation_id_fkey;
    ALTER TABLE public.ai_call_logs
      ADD CONSTRAINT ai_call_logs_conversation_id_fkey
      FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.scheduled_messages') IS NOT NULL THEN
    ALTER TABLE public.scheduled_messages
      DROP CONSTRAINT IF EXISTS scheduled_messages_conversation_id_fkey;
    ALTER TABLE public.scheduled_messages
      ADD CONSTRAINT scheduled_messages_conversation_id_fkey
      FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.kaspi_invoices') IS NOT NULL THEN
    ALTER TABLE public.kaspi_invoices
      DROP CONSTRAINT IF EXISTS kaspi_invoices_conversation_id_fkey;
    ALTER TABLE public.kaspi_invoices
      ADD CONSTRAINT kaspi_invoices_conversation_id_fkey
      FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;
  END IF;
END $$;

DROP POLICY IF EXISTS "org members can delete agents" ON public.agents;
CREATE POLICY "owners and admins can delete agents"
  ON public.agents FOR DELETE
  USING (
    org_id IN (
      SELECT org_id
      FROM public.org_members
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );
