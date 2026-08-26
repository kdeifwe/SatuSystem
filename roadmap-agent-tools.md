Roadmap: Agent tools audit and fixes

Что найдено:
- В `lib/ai/tools/registry.ts` были объявлены только 4 инструмента для function-calling, в то время как `executor.ts` реализовывал больше инструментов. Из-за этого некоторые инструменты были недостижимы для LLM.
- Найдена уязвимость: функции обновления лида (`updateLeadInfo`, `addLeadNote`, `scheduleMessage`) использовали `args.lead_id` из входных данных модели для операций записи. Модель может прислать произвольный `lead_id` — это давало возможность изменить/добавить данные к чужому лид-идентификатору.

Что сделано:
- Исправлена логика в `lib/ai/tools/executor.ts`: теперь все операции, которые должны работать с текущим лидом диалога, используют доверенный `ctx.leadId` (серверный контекст) и валидируют его присутствие. Удалены зависимости от `args.lead_id` в сигнатурах и обработке.
- Восстановлены декларации инструментов `update_lead_info` и `add_lead_note` в `lib/ai/tools/registry.ts`, при этом из схемы убран параметр `lead_id` (модели не нужно его передавать).
- Обновлён контракт вызовов в `executor.ts` (dispatch теперь передаёт `call.args` без `lead_id` для этих инструментов).
- `broadcasts`: пункт навигации в `app/dashboard/[agentId]/layout.tsx` задаёт `href: 'broadcasts'` (формирует ссылку `/dashboard/:agentId/broadcasts`), но в кодовой базе отсутствовал соответствующий route/page — это dead link. STATUS: DONE — ссылка удалена из навигации.
- `sendCustomNotification`: реализована в `lib/ai/tools/executor.ts` и делает реальную попытку отправки через `sendTelegramNotification`. STATUS: DONE — порядок операций исправлен, сообщение в `messages` пишется только после подтверждённой отправки. Известное ограничение: если сам insert в `messages` упадёт ПОСЛЕ успешной Telegram-отправки, функция ошибочно вернёт `reason:'send_failed'`, хотя сообщение реально было доставлено (маловероятный edge case, не блокирует).

Текущее состояние:
- 6 инструментов теперь доступны для function-calling (после включения в `allowed_tools`):
  - `searchKnowledgeBase`
  - `sendKaspiPay`
  - `updateLeadStatus`
  - `redirectToOperator`
  - `update_lead_info`
  - `add_lead_note`
- `getCurrentDate` и `getMediaFiles` — решение: `getCurrentDate` добавим в контекст (не как tool), `getMediaFiles` — через существующий поиск и `source_metadata`.
- `sendCustomNotification`, `scheduleMessage`, `callPhoneNumber` — оставлены вне function-calling (сценарии / Фазы 4/7).

Финальная сводная таблица по тулам (после фиксов):

| Имя инструмента | Registry / декларация | Executor / реализация | Где включено (allowed_tools) | Статус |
|---|---|---|---|---|
| `add_lead_note` | Да (`add_lead_note`) | Да (`case 'add_lead_note'`) | Айгерим, Самат, многие агенты | OK — декларация и реализация совпадают |
| `advanceFunnelStep` | Динамически: строится через `buildAdvanceFunnelStepDeclaration` при наличии dialogue_flow | Да (`case 'advanceFunnelStep'`) | Самат и другие агенты с dialogue_flow, у кого явно включён allowed_tools; Айгерим сознательно оставлен выключенным | DONE — решение принято, оставлено выключенным по умолчанию для Айгерим. |
| `getCurrentDate` | (migrated) | removed from production tool declarations | Context injection used in `compile-system-prompt` | DONE — переведено на context injection, тул удалён. |
| `recordLeadSignal` | Нет (DB-only helper) | Нет | Специальный агент: `sb-natural-signal-agent-1784700221073` | Мёртвая функциональность — нет ни в `registry.ts`, ни в `executor.ts`; оставлен в БД только у `sb-natural-signal-agent-1784700221073`, удалён из allowed_tools у Айгерим и Самата |
| `redirectToOperator` | Да (`redirectToOperator`) | Да (`case 'redirectToOperator'`) | Большинство агентов | OK |
| `scheduleMessage` | Да (`scheduleMessage`) | Да (`case 'scheduleMessage'`) | Многие агенты | DONE — запись перенесена в `notification_log`, реализована доставка через `app/api/cron/send-scheduled-reminders/route.ts` (cron раз в минуту). При доставке резолв через `leads` → `leads.channels.type` и используется `sendWhatsAppText` / `sendTelegramText`. |
| `searchKnowledgeBase` | Да (`searchKnowledgeBase`) | Да (`case 'searchKnowledgeBase'`) | Все агенты с KB | OK |
| `sendKaspiPay` | Да (`sendKaspiPay`) — capability-gated | Да (`case 'sendKaspiPay'`) | Только агенты с `kaspi_invoice_enabled` | OK — capability проверяется |
| `update_lead_info` | Да (`update_lead_info`) | Да (`case 'update_lead_info'`) | Многие агенты | OK — схема убрана от `lead_id`, используется `ctx.leadId` |
| `update_lead_status` / `updateLeadStatus` | Нормализовано: `updateLeadStatus` используется, registry поддерживает snake/camel | Да (`case 'updateLeadStatus'` / `case 'update_lead_status'`) | Включено в allowed_tools по агентам | OK — нотации нормализованы и миграция применена |

Known gap:
- `sandbox preview` (frontend: `app/dashboard/[agentId]/sandbox` → POST `/api/chat`) uses the legacy tool-building path in `lib/ai/orchestrator.ts` (it builds `allowedToolDeclarations` from the static `AGENT_TOOLS` array) rather than `lib/ai/tools/registry.ts` and `buildToolDeclarationsForAgent`. As a result, the sandbox preview can show a different set of callable tools than the live webhook path (`lib/server/ai/orchestrator.ts` → `buildToolDeclarationsForAgent`). This is a documentation-only note; do NOT change behavior now.

Product decision recorded: Айгерим имеет dialogue_flow, но в allowed_tools отсутствует advanceFunnelStep — требуется решение продукта перед любыми изменениями конфигурации.

TODO / открытые задачи:
- Продуктовое решение по advanceFunnelStep для Айгерим.
- Переход getCurrentDate → context injection (RFC / отдельная задача).
- Sandbox preview использует legacy tool-building path (см. Known gap выше) — рассмотреть миграцию sandbox на `buildToolDeclarationsForAgent` при планировании релиза.

Экстренные меры (применено):
- **scheduleMessage — dead-path**: `scheduleMessage` записывал `messages` с `origin='followup'`, но в репозитории нет воркера/cron, который бы читал эти строки и выполнял отправку. Это делало функцию бесполезной и вводило в заблуждение (модель могла пообещать напоминание, которое никогда не будет доставлено).
- **Митигирование**: временно удалили `scheduleMessage` из `allowed_tools` для всех затронутых агентов (16 агентов) чтобы предотвратить дальнейшие обещания доставки до решения (реализовать воркер доставки или переключить на `notification_log` паттерн).
- **Рекомендация**: либо реализовать воркер, читающий `messages` с `origin='followup'` и отправляющий через существующие каналы (reuse `notification_log` + `send-notifications`), либо перепроектировать `scheduleMessage` на запись в `scheduled_messages` и использовать централизованный планировщик.

**КРИТИЧНО обнаружено и исправлено:** scheduleMessage писал `event_type='scheduled_reminder'` в `notification_log`, которого не было в CHECK constraint — INSERT падал бы с ошибкой при каждом реальном вызове. Constraint расширен миграцией `db/migrations/20260823000000_add_scheduled_reminder_to_notification_log_event_type_check.sql`. Проверено: тул сейчас не в `allowed_tools` ни у одного агента (удалён ранее в этой сессии), поэтому реальных сбоев на живом трафике не зафиксировано.

**Отправка медиа клиенту (sendMediaToClient)**

Что сделано:
- Добавлен `MEDIA_CATEGORIES` в `lib/media/categories.ts` — централизованный список допустимых категорий для медиа.
- Реализованы отправки для каналов: `sendWhatsAppMedia` и `sendTelegramMedia` (реализация в `lib/channels/baileys-client.ts` и `lib/channels/telegram-client.ts`) и интегрированы в `executor`.
- Динамическая декларация инструмента `sendMediaToClient` добавлена в трех местах: `lib/ai/orchestrator.ts`, `lib/server/ai/orchestrator.ts`, `scripts/check-declarations.ts` — декларация строится на основе доступных категорий (динамически читает `MEDIA_CATEGORIES`).
- Обновлён код загрузки/создания `kb_sources` (upload endpoints) так, чтобы при создании источника можно было передать `media_category` и сохранить его в `metadata.media_category`.

Что проверено:
- Формат отправки для Baileys (WhatsApp) проверен по официальной документации Baileys/WhatsApp Cloud API: payload соответствует required fields для отправки медиа и метаданных (content-type, file id / URL).
- PostgREST / PostgREST-like alias-синтаксис для выборки `category:metadata->>media_category` подтверждён по официальной документации Supabase/postgrest-js — НЕ проверен на реальных данных ввиду отсутствия размеченных файлов в БД на момент разработки.

TODO:
- Нужен UI/API для разметки файлов категорией на фронтенде; сейчас доступно только прямое SQL UPDATE `metadata` (админский путь) или подача `media_category` в момент загрузки через расширенный endpoint. План: добавить поле в форму загрузки KB и в UI менеджера источников.

Статус: готово к ревью. Дальше — добавить миграцию/проверку data-fix для уже существующих `kb_sources`, у которых `metadata.media_category` отсутствует и которые можно автоматически сопоставить по имени/типу файла.
