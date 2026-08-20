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
- `getCurrentDate` и `getMediaFiles` — решение: `getCurrentDate` добавим в контекст (не как tool), `getMediaFiles` — через существующий поиск и `source_metadata`.
- `sendCustomNotification`, `scheduleMessage`, `callPhoneNumber` — оставлены вне function-calling (сценарии / Фазы 4/7).

Финальная сводная таблица по тулам (после фиксов):

| Имя инструмента | Registry / декларация | Executor / реализация | Где включено (allowed_tools) | Статус |
|---|---|---|---|---|
| `add_lead_note` | Да (`add_lead_note`) | Да (`case 'add_lead_note'`) | Айгерим, Самат, многие агенты | OK — декларация и реализация совпадают |
| `advanceFunnelStep` | Динамически: строится через `buildAdvanceFunnelStepDeclaration` при наличии dialogue_flow | Да (`case 'advanceFunnelStep'`) | Самат и другие агенты с dialogue_flow, у кого явно включён allowed_tools; Айгерим сознательно не включён | OK для Самат (и других агентов с dialogue_flow, у кого явно включён allowed_tools); для Айгерим сознательно не включён — см. Product decision ниже |
| `getCurrentDate` | Да (`getCurrentDate`) | Да (`case 'getCurrentDate'`) | Много агентов (контекст) | OK — декларация добавлена сегодня и доступна через function-calling; переход на context-injection вместо tool-based подхода отложен как отдельная задача (см. TODO ниже) |
| `recordLeadSignal` | Нет (DB-only helper) | Нет | Специальный агент: `sb-natural-signal-agent-1784700221073` | Мёртвая функциональность — нет ни в `registry.ts`, ни в `executor.ts`; оставлен в БД только у `sb-natural-signal-agent-1784700221073`, удалён из allowed_tools у Айгерим и Самата |
| `redirectToOperator` | Да (`redirectToOperator`) | Да (`case 'redirectToOperator'`) | Большинство агентов | OK |
| `scheduleMessage` | Да (`scheduleMessage`) | Да (`case 'scheduleMessage'`) | Многие агенты | OK — декларация добавлена сегодня, доступен через function-calling везде, где включён в `allowed_tools` |
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
