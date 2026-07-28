-- Add STC tracking columns to ai_call_logs if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_call_logs' AND column_name = 'dialog_stage'
  ) THEN
    ALTER TABLE ai_call_logs ADD COLUMN dialog_stage text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_call_logs' AND column_name = 'stc_technique_count'
  ) THEN
    ALTER TABLE ai_call_logs ADD COLUMN stc_technique_count int DEFAULT 0;
  END IF;
END $$;
