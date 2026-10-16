-- Reset unsupported legacy LLM model values to the default Gemini model.
-- This migration is intentionally left as a preview/update script and was not applied to the database.

SELECT id, name, model
FROM agents
WHERE model ILIKE 'gpt-%'
   OR model ILIKE 'gpt4%'
   OR model ILIKE 'llama-%'
   OR model ILIKE 'mixtral-%';

UPDATE agents
SET model = 'gemini-3.8-flash'
WHERE model ILIKE 'gpt-%'
   OR model ILIKE 'gpt4%'
   OR model ILIKE 'llama-%'
   OR model ILIKE 'mixtral-%';
