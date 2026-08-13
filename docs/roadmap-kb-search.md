Roadmap: KB Search

- Action: Do not change `getChunkPriorityBoost`/`keywordBonus` weights in this task.
  - Rationale: weight calibration is a separate effort. Current values (0.18/0.14/0.08/-0.16/-0.06 and keywordBonus 0.05) must be preserved until a dedicated calibration run.
  - Follow-up: schedule a calibration task to evaluate and tune `priorityBoost` vs `similarity` vs `keywordBonus`.

- Next major tasks:
  1. Apply hybrid `search_knowledge_base` migration in a safe rollout (additive RPC + canary traffic).
  2. Verify application passes `p_query_text` in all call paths and update RPC signature caches.
  3. Re-run ranking validation across representative queries after hybrid rollout.
  4. Telemetry: add logging for rankingScore components (similarity/keyword/priority) for top-N for offline analysis.

