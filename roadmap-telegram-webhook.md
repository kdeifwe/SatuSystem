# Telegram webhook incident — diagnosis & fix

Дата: 2026-08-25

Кратко:
- Проблема: Telegram получил `404 Not Found` при обращении к webhook — бот не отвечал на входящие сообщения.
- Root cause: в проде переменная `NEXT_PUBLIC_APP_URL` была устаревшей (без суффикса `-3cfa`), из-за чего изначально зарегистрированный webhook указывал на старый домен `satusystem-production.up.railway.app`.

Что сделано:
1. Проверил токен и текущий webhook через Telegram API — `getWebhookInfo` показал `Wrong response from the webhook: 404 Not Found`.
2. Установил корректный webhook для агента `9b7cf5df-9055-4a14-a77c-e006a4454f5d` (бот `juz40informationbot`) на `https://satusystem-production-3cfa.up.railway.app/api/webhooks/telegram/9b7cf5df-9055-4a14-a77c-e006a4454f5d` (выполнен `setWebhook`).
3. Проверил `ai_call_logs` — до фикса записи были отсутствовали, после — появился лог с ответом агента (см. пример в базе).
4. Обновил в Railway значение `NEXT_PUBLIC_APP_URL` на `https://satusystem-production-3cfa.up.railway.app` и задеплоил сервис (redeploy), чтобы новая переменная применялась при старте.

Проверки:
- `getWebhookInfo` после фикса: `url` указывает на `satusystem-production-3cfa.up.railway.app`, `pending_update_count` = 0, `last_error_message` отсутствует.
- `ai_call_logs` для канала `703f7f17-54cb-4b9a-8f91-5cc4f6f6b55f` содержит запись с текстом-ответом: "Саламатсызба! Қалай көмектесе аламын?" (время 2026-08-25 06:37:14 UTC), подтверждающая сквозную обработку.

Рекомендации (follow-up):
- Проверять и синхронизировать `NEXT_PUBLIC_APP_URL` после каждого изменения публичного домена/переноса сервиса (добавить в deployment checklist).
- Добавить мониторинг: оповещение при `pending_update_count > 0` или `last_error_message` в ответе `getWebhookInfo` для каждого токена Telegram в БД.
- При изменении домена — автоматически пройти по всем записанным `channels.credentials.token` и выполнить `setWebhook` на новый домен.

Контакты: команда DevOps / ответственный за деплой.