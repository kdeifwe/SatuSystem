-- Set explicit kaspi_invoice_enabled for all agents

UPDATE agents
SET general_capabilities = coalesce(general_capabilities, '{}'::jsonb) || jsonb_build_object('kaspi_invoice_enabled', false)
WHERE id != '2f0cafdd-3189-411c-a2e5-fb41b8ecaba3';

UPDATE agents
SET general_capabilities = coalesce(general_capabilities, '{}'::jsonb) || jsonb_build_object('kaspi_invoice_enabled', true)
WHERE id = '2f0cafdd-3189-411c-a2e5-fb41b8ecaba3';
