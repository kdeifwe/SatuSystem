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
- Выполнен `refresh_kb_chunk_links` для всех трёх агентов с калиброванным порогом `p_min_similarity = 0.55` (порог рассчитан по полной выборке 155 чанков, p25 top3 ≈ 0.53). Семантические ссылки пересчитаны: 343 (старые Gemini) → 201 (актуальные OpenAI). Результат проверен через `searchKnowledgeBaseWithLinks` + `get_linked_kb_chunks` (функциональный тест).

Что осталось
- Провести калибровку `hybrid_score` и `getChunkPriorityBoost` через оффлайн-метрики и A/B (не менять сейчас).
- (Done) `kb_chunk_links` refresh выполнен — см. раздел "Что сделано".
- Включить логирование случаев `provider IS NULL` / невалидных embedding-строк для диагностики и мониторинга.

Разное, не проверено
- (Перенесено) `kb_chunk_links` подробности перенесены в раздел «Что сделано» после выполнения refresh.
