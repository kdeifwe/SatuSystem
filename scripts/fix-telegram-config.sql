-- Установить bot_token и recipients для телеграм-уведомлений
UPDATE extension_settings
SET config = jsonb_set(
  jsonb_set(config, '{bot_token}', '"ВАШ_ТОКЕН_ОТ_BOTFATHER"'),
  '{recipients}',
  '["6426534844"]'::jsonb
)
WHERE extension_type = 'telegram_notifications';

-- Добавить enabled=true для events.operator_needed по умолчанию
UPDATE extension_settings
SET config = jsonb_set(config, '{events,operator_needed,enabled}', 'true'::jsonb)
WHERE extension_type = 'telegram_notifications';

-- Проверка
SELECT id, agent_id, config
FROM extension_settings
WHERE extension_type = 'telegram_notifications';
