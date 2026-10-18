export type RepeatTouchesMode = 'ai_generated' | 'fixed_templates';

export interface RepeatTouchesConfig {
  /**
   * Через сколько МИНУТ тишины (считая от последнего нашего сообщения) отправлять
   * касание №2, №3 (и №4). Длина массива = число повторных касаний (1..3).
   */
  schedule_minutes: number[];
  /** Окно отправки (часы по времени организации). Вне окна касания не уходят. */
  window_start_hour: number;
  window_end_hour: number;
  message_mode: RepeatTouchesMode;
  fixed_templates: string[];
  /** Лидов в этих статусах не трогаем. */
  stop_statuses: string[];
  stop_if_ai_disabled: boolean;
  /** Не касаться диалогов, где последнее сообщение старше N часов. */
  max_silence_hours: number;
  /** Момент включения: старше этой отметки диалоги не трогаем (защита от рассылки по старой базе). */
  activated_at: string | null;
}

export const MAX_TOUCHES = 3;
export const MAX_DELAY_MINUTES = 7 * 24 * 60;

export const DEFAULT_REPEAT_TOUCHES_CONFIG: RepeatTouchesConfig = {
  schedule_minutes: [180, 1440],
  window_start_hour: 10,
  window_end_hour: 20,
  message_mode: 'ai_generated',
  fixed_templates: [
    'Добрый день! Напоминаю о нашем диалоге: вы ещё рассматриваете этот вариант? Подскажу, если остались вопросы 🙂',
    'Чтобы не потерять нить разговора — вы ещё думаете над предложением? Если удобнее, можем вернуться к этому позже.',
    'Последнее напоминание с моей стороны 🙂 Если актуально — просто напишите, и мы всё оформим.',
  ],
  stop_statuses: ['won', 'lost', 'closed', 'done'],
  stop_if_ai_disabled: true,
  max_silence_hours: 96,
  activated_at: null,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeRepeatTouchesConfig(raw: unknown): RepeatTouchesConfig {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_REPEAT_TOUCHES_CONFIG;

  // Старый формат (schedule_hours) автоматически переводим в минуты.
  const rawMinutes: unknown[] = Array.isArray(src.schedule_minutes)
    ? src.schedule_minutes
    : Array.isArray(src.schedule_hours)
      ? src.schedule_hours.map((v) => Number(v) * 60)
      : [];
  let schedule = rawMinutes.map((v) => clampInt(v, 1, MAX_DELAY_MINUTES, 0)).filter((v) => v > 0);
  if (schedule.length === 0) schedule = [...d.schedule_minutes];
  schedule = schedule.slice(0, MAX_TOUCHES);

  const start = clampInt(src.window_start_hour, 0, 23, d.window_start_hour);
  let end = clampInt(src.window_end_hour, 1, 24, d.window_end_hour);
  if (end <= start) end = Math.min(24, start + 1);

  const templates = Array.isArray(src.fixed_templates)
    ? src.fixed_templates.map((v) => String(v ?? '').trim()).filter(Boolean).slice(0, MAX_TOUCHES)
    : [];

  const stopStatuses = Array.isArray(src.stop_statuses)
    ? src.stop_statuses.map((v) => String(v ?? '').trim().toLowerCase()).filter(Boolean)
    : d.stop_statuses;

  return {
    schedule_minutes: schedule,
    window_start_hour: start,
    window_end_hour: end,
    message_mode: src.message_mode === 'fixed_templates' ? 'fixed_templates' : 'ai_generated',
    fixed_templates: templates.length > 0 ? templates : [...d.fixed_templates],
    stop_statuses: stopStatuses,
    stop_if_ai_disabled: src.stop_if_ai_disabled === false ? false : true,
    max_silence_hours: clampInt(src.max_silence_hours, 6, 24 * 30, d.max_silence_hours),
    activated_at: typeof src.activated_at === 'string' && src.activated_at ? src.activated_at : null,
  };
}
