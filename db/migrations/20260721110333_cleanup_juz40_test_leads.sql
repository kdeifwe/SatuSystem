-- Remove test-only lead records that were created inside the Juz40 organization.
DELETE FROM ai_call_logs
WHERE conversation_id IN (
  SELECT id
  FROM conversations
  WHERE lead_id IN (
    SELECT id
    FROM leads
    WHERE org_id = '586db722-f04f-4821-bd3c-57b7b94d50d6'
      AND lower(name) IN ('test lead grade 11', 'fresh test lead grade 11', 'test lead grade 11')
  )
);

DELETE FROM messages
WHERE conversation_id IN (
  SELECT id
  FROM conversations
  WHERE lead_id IN (
    SELECT id
    FROM leads
    WHERE org_id = '586db722-f04f-4821-bd3c-57b7b94d50d6'
      AND lower(name) IN ('test lead grade 11', 'fresh test lead grade 11', 'test lead grade 11')
  )
);

DELETE FROM conversations
WHERE lead_id IN (
  SELECT id
  FROM leads
  WHERE org_id = '586db722-f04f-4821-bd3c-57b7b94d50d6'
    AND lower(name) IN ('test lead grade 11', 'fresh test lead grade 11', 'test lead grade 11')
);

DELETE FROM leads
WHERE org_id = '586db722-f04f-4821-bd3c-57b7b94d50d6'
  AND lower(name) IN ('test lead grade 11', 'fresh test lead grade 11', 'test lead grade 11');
