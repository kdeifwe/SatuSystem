BEGIN;

UPDATE agents
SET general_capabilities = COALESCE(general_capabilities, '{}'::jsonb)
  || '{"allowed_tools": ["searchKnowledgeBase", "redirectToOperator", "getCurrentDate", "add_lead_note"]}'::jsonb
WHERE general_capabilities IS NULL
   OR NOT (general_capabilities ? 'allowed_tools')
   OR general_capabilities->'allowed_tools' IS NULL
   OR (
        jsonb_typeof(general_capabilities->'allowed_tools') = 'array'
        AND jsonb_array_length(general_capabilities->'allowed_tools') = 0
      );

COMMIT;
