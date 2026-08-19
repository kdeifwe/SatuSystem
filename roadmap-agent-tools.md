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

Дальше (по вашему запросу):
1) SELECT текущих `general_capabilities` для указанных агентов (ниже). Жду ОК, чтобы выполнить UPDATE и записать `allowed_tools` в БД.
2) После вашей ОК — выполню UPDATE, затем пересоберу системные промпты для всех активных агентов и проверю, что `update_lead_info` присутствует в сгенерированном `system_prompt_compiled` для Айгерим.

---
