Roadmap: Agent tools audit and fixes

Что найдено:
- В `lib/ai/tools/registry.ts` были объявлены только 4 инструмента для function-calling, в то время как `executor.ts` реализовывал больше инструментов. Из-за этого некоторые инструменты были недостижимы для LLM.
- Найдена уязвимость: функции обновления лида (`updateLeadInfo`, `addLeadNote`, `scheduleMessage`) использовали `args.lead_id` из входных данных модели для операций записи. Модель может прислать произвольный `lead_id` — это давало возможность изменить/добавить данные к чужому лид-идентификатору.

Что сделано:
- Исправлена логика в `lib/ai/tools/executor.ts`: теперь все операции, которые должны работать с текущим лидом диалога, используют доверенный `ctx.leadId` (серверный контекст) и валидируют его присутствие. Удалены зависимости от `args.lead_id` в сигнатурах и обработке.
- Восстановлены декларации инструментов `update_lead_info` и `add_lead_note` в `lib/ai/tools/registry.ts`, при этом из схемы убран параметр `lead_id` (модели не нужно его передавать).
- Обновлён контракт вызовов в `executor.ts` (dispatch теперь передаёт `call.args` без `lead_id` для этих инструментов).

Текущее состояние:
- 6 инструментов теперь доступны для function-calling (после включения в `allowed_tools`):
  - `searchKnowledgeBase`
  - `sendKaspiPay`
  - `updateLeadStatus`
  - `redirectToOperator`
  - `update_lead_info`
  - `add_lead_note`
- `getCurrentDate` и `getMediaFiles` — решено: `getCurrentDate` добавим в контекст (не как tool), `getMediaFiles` — через существующий поиск и `source_metadata` (не новый тул сейчас).
- `sendCustomNotification`, `scheduleMessage`, `callPhoneNumber` — оставлены вне function-calling (сценарии/Фазы 4/7).

Финальная сводная таблица по тулам (после фиксов):

| Имя инструмента | В `registry.ts` | В `executor.ts` | У кого в `allowed_tools` (примеры) | Статус после фикса |
|---|---:|---:|---|---|
| add_lead_note | Да (`add_lead_note`) | Да (`case 'add_lead_note'`) | Айгерим, Самат, многие агенты | OK — декларация + реализация совпадают |
| advanceFunnelStep | Динамически: строится через `buildAdvanceFunnelStepDeclaration` при наличии в allowed_tools | Да (`case 'advanceFunnelStep'`) | Самат, несколько агентов | OK — теперь декларация генерируется при необходимости |
| getCurrentDate | Да (`getCurrentDate`) | Да (`case 'getCurrentDate'`) | Многие агенты (напр., Айгерим, Самат) | OK — объявлен и доступен для function-calling |
| recordLeadSignal | Нет | Нет | Одна remaining: `sb-natural-signal-agent-1784700221073` | Оставлен в БД только где нужен; удалён из Айгерим/Самат |
| redirectToOperator | Да (`redirectToOperator`) | Да (`case 'redirectToOperator'`) | Большинство агентов | OK |
| scheduleMessage | Да (`scheduleMessage`) | Да (`case 'scheduleMessage'`) | Многие агенты | OK — объявлен и доступен |
| searchKnowledgeBase | Да (`searchKnowledgeBase`) | Да (`case 'searchKnowledgeBase'`) | Все агенты с KB-доступом | OK |
| sendKaspiPay | Да (`sendKaspiPay`) — фильтруется capability | Да (`case 'sendKaspiPay'`) | Только агенты с `kaspi_invoice_enabled` | OK — фильтрация по capability сохранена |
| update_lead_info | Да (`update_lead_info`) | Да (`case 'update_lead_info'`) | Многие агенты | OK — схема без `lead_id`, сервер использует `ctx.leadId` |
| update_lead_status / updateLeadStatus | Нормализовано: `updateLeadStatus` объявлено, registry теперь устойчив к snake/camel | Да (`case 'updateLeadStatus'` и `case 'update_lead_status'`) | Ранее snake_case в DB; теперь заменено на `updateLeadStatus` в allowed_tools | OK — нормализация + DB-миграция выполнены |

Статусы и примечания:
- Нормализация имён защищает от будущих рассинхроний между БД и кодом.
- `recordLeadSignal` — мёртвая строка в большинстве агентов; удалена из Айгерим и Самат. Осталась только у специального агента `sb-natural-signal-agent-1784700221073`.
- `getCurrentDate` добавлен в декларации как tool (чтобы не ломать существующие конфиги); но TODO: обсуждение — возможно стоит вместо этого пробрасывать дату в контекст (отдельный таск).

Дальше выполненные шаги в этом PR/коммите:
- registry: добавлена нормализация имён и динамическая генерация `advanceFunnelStep`.
- registry: добавлены декларации `getCurrentDate` и `scheduleMessage`.
- DB: выполнена миграция — `update_lead_status` → `updateLeadStatus` для агентов; `recordLeadSignal` удалён из Айгерим и Самат.
- Сборка: пересобраны системные промпты для всех активных агентов и проверены декларации для Айгерим и Самат.


Дальше (по вашему запросу):
1) SELECT текущих `general_capabilities` для указанных агентов (ниже). Жду ОК, чтобы выполнить UPDATE и записать `allowed_tools` в БД.
2) После вашей ОК — выполню UPDATE, затем пересоберу системные промпты для всех активных агентов и проверю, что `update_lead_info` присутствует в сгенерированном `system_prompt_compiled` для Айгерим.

---
