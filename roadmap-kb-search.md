Roadmap: KB Search

Overview
- Preserve current ranking formula (do not change boost weights in this task).

Regression: final-similarity sort
- Issue: A recent patch added a final sort by `similarity` after `rankKnowledgeBaseChunks`, which
  wiped out the effects of `keywordBonus` and `priorityBoost` and caused a regression in the
  returned ordering (effectively reverting to vector-only ordering).
- Fix: reverted the final similarity-only sort; the canonical final order is now the output of
  `rankKnowledgeBaseChunks` (sorted by `rankingScore = similarity + keywordBonus + priorityBoost`).

PriorityBoost calibration (TODO)
- DO NOT change `getChunkPriorityBoost` or `keywordBonus` in this task. Current values must be
  preserved and audited in a separate calibration run.
- ACTION: create a calibration task to evaluate and tune these weights versus similarity and
  keyword boost. Suggested next steps: gather offline telemetry (top-N components), run A/B tests,
  and tune weights based on business metrics.

Next major steps
1. Apply hybrid `search_knowledge_base` migration in a safe rollout (additive RPC + canary traffic).
2. Verify application passes `p_query_text` on all call paths and update any DB schema cache where needed.
3. Re-run ranking validation across representative queries after hybrid rollout.
4. Add telemetry to log rankingScore components (similarity/keyword/priority) for top-N results for offline analysis.

Notes
- This file consolidates the roadmap content previously staged in `docs/roadmap-kb-search.md`.

Что сделано
- Полное восстановление/ре-эмбед всех KB-чанков в OpenAI `text-embedding-3-small` (768d) — устранение смешанных векторов.
- Применена гибридная миграция `search_knowledge_base` в базу (после ручной проверки и одобрения).
- Откат регрессии: удалён финальный `.sort()` по `similarity`, восстановлено финальное ранжирование по `rankingScore`.

Что осталось
- Провести калибровку `hybrid_score` и `getChunkPriorityBoost` через оффлайн-метрики и A/B (не менять сейчас).
- Запланировать `kb_chunk_links` refresh (пересчёт semantic links на новых OpenAI-эмбеддингах) перед использованием `get_linked_kb_chunks` в продуктиве.
- Включить логирование случаев `provider IS NULL` / невалидных embedding-строк для диагностики и мониторинга.

Разное, не проверено
- `kb_chunk_links` существовала в БД ДО этой сессии: 569 строк (created_at диапазон 2026-07-07 — 2026-08-03). Распределение: 343 `semantic`, 226 `same_source`. По `agent_id`: 551 записи для `1469465d-418d-44ac-9751-a304666e6dc4` и 18 для `9b7cf5df-9055-4a14-a77c-e006a4454f5d`. Оба `agent_id` присутствуют в таблице `agents` (нет orphan agent_id). Появившиеся данные означают, что таблица была создана и/или заполнена ранее (вне git) — возможный case schema drift. Не проверено: актуальность этих semantic-связей после сегодняшнего re-embed на OpenAI (раньше связи считались на старых Gemini-векторах). Рекомендуется выполнить `refresh_kb_chunk_links` на новых эмбеддингах перед реальным использованием `get_linked_kb_chunks`.
