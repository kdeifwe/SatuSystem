Roadmap: KB Search

Overview
- Preserve current ranking formula (do not change boost weights in this task).

Regression: final-similarity sort
- Issue: A recent patch added a final sort by `similarity` after `rankKnowledgeBaseChunks`, which
  wiped out the effects of `keywordBonus` and `priorityBoost` and caused a regression in the
  returned ordering (effectively reverting to vector-only ordering).
- Fix: reverted the final similarity-only sort; the canonical final order is now the output of
  `rankKnowledgeBaseChunks` (sorted by `rankingScore = similarity + keywordBonus + priorityBoost`).

PriorityBoost calibration (status)
- Статус: выполнено — проведена оффлайн калибровка по репрезентативной выборке реальных клиентских
  вопросов. Системных перекосов hybrid_score/priorityBoost не обнаружено; сохранены текущие веса.
  (Детали проверки и выборки зафиксированы в артефактах разработки.)

Находки для владельца контента
- В ходе калибровки по реальным запросам про цену/оплату (например, «багасы канша?», «канша багасы?",
  «толем калай жасаймын?») обнаружено, что в ~2 из 3 разобранных случаев топ‑результаты поиска НЕ
  содержат прямого ответа с явной ценой. Причина — не системная ошибка ранжирования, а отсутствие
  контента в базе знаний, формулированного так, как реально спрашивают клиенты.
- Рекомендация для владельца агента (контент‑владелец): добавить в KB явные Q&A‑пары вида
  "Сколько стоит? / Багасы қанша?" с конкретными цифрами и кратким описанием тарифа/условий. Это
  даст быстрый выигрыш в качестве ответов пользователям, вместо того чтобы полагаться на поиск по
  разрозненным product‑описаниям или промо‑постам.

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
 - 2026-08-14: Добавлена инструкция в глобальный шаблон компиляции системного промпта о переиспользовании `leadAttributes` и обязательном вызове `update_lead_info` при появлении новых фактов о клиенте (имя, телефон, класс/возраст, конкретный интерес). Проверить через неделю: доля `update_lead_info` среди `agent_response` вызовов (базово ~3-6%, ожидаем рост).

**KB health check**
- 2026-08-14: Добавлена SQL-функция `public.kb_health_check()` для ручной проверки целостности базы знаний. Функция возвращает по одной строке на агента: `agent_id`, `agent_name`, `total_chunks`, `null_embedding_count`, `null_search_vector_count`, `embedding_provider_mismatch_count`, `stale_semantic_links`.
- Как запустить вручную (через psql или прямой PG-клиент):
  - Выполнить SQL миграцию `db/migrations/20260814000000_kb_health_check.sql` (создаёт/перезаписывает функцию).
  - Затем выполнить:

```
SELECT * FROM public.kb_health_check();
```

  - Ожидаемый результат после очистки: нули в колонках счётчиков для всех агентов.

Что осталось
- Включить логирование случаев `provider IS NULL` / невалидных embedding-строк для диагностики и мониторинга.

Разное, не проверено
- (Перенесено) `kb_chunk_links` подробности перенесены в раздел «Что сделано» после выполнения refresh.

Сессия по улучшению KB search завершена 2026-08-13. Токен-логирование provider=null и решение по типизированному графу знаний — на усмотрение следующей сессии, не блокируют текущую работу поиска.
