-- Установить bot_token для телеграм-уведомлений
UPDATE extension_settings
SET config = jsonb_set(
  config,
  '{bot_token}',
  '"ВАШ_ТОКЕН_ОТ_BOTFATHER"'::jsonb
)
WHERE extension_type = 'telegram_notifications';

-- Нормализовать recipients: если в config хранится chat_id, привести к profile_id через profiles.telegram_chat_id
UPDATE extension_settings
SET config = jsonb_set(
  config,
  '{recipients}',
  COALESCE(
    (
      SELECT jsonb_agg(to_jsonb(COALESCE(p.id::text, recipient_value)))
      FROM jsonb_array_elements_text(COALESCE(config->'recipients', '[]'::jsonb)) AS recipient_value
      LEFT JOIN profiles p ON p.telegram_chat_id = recipient_value
    ),
    '[]'::jsonb
  )
)
WHERE extension_type = 'telegram_notifications'
  AND config ? 'recipients'
  AND jsonb_typeof(config->'recipients') = 'array';

-- Добавить enabled=true для events.operator_needed по умолчанию
UPDATE extension_settings
SET config = jsonb_set(config, '{events,operator_needed,enabled}', 'true'::jsonb)
WHERE extension_type = 'telegram_notifications';

-- Проверка
SELECT id, agent_id, config
FROM extension_settings
WHERE extension_type = 'telegram_notifications';
