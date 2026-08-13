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
