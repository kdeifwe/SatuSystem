export const LOST_REASONS = ['price', 'timing', 'competitor', 'postponed', 'wrong_product', 'no_response', 'other'] as const;

export type LostReason = (typeof LOST_REASONS)[number];

export const LOST_REASON_LABELS: Record<LostReason, string> = {
  price: 'Цена',
  timing: 'Сроки',
  competitor: 'Ушёл к конкуренту',
  postponed: 'Передумал или отложил',
  wrong_product: 'Не тот продукт',
  no_response: 'Не ответил',
  other: 'Другое',
};

// Причины, на которые можно повлиять промптом агента. «Не ответил» и «Не тот продукт»
// чаще про воронку и качество трафика, их не скармливаем улучшению промпта.
export const PROMPT_FIXABLE_REASONS: LostReason[] = ['price', 'timing', 'competitor', 'postponed', 'other'];

export const LOST_NOTE_MAX = 300;

export function normalizeLostReason(value: unknown): LostReason | null {
  const v = String(value ?? '').trim().toLowerCase();
  return (LOST_REASONS as readonly string[]).includes(v) ? (v as LostReason) : null;
}
