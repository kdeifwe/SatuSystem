export type TelegramEventConfig = {
  operator_needed?: { enabled?: boolean };
  channel_down?: { enabled?: boolean };
  ai_silent?: { enabled?: boolean; threshold_minutes?: number };
  deal_won?: { enabled?: boolean };
  deal_lost?: { enabled?: boolean };
  new_lead?: { enabled?: boolean };
  contact_received?: { enabled?: boolean };
  repeat_touches_exhausted?: { enabled?: boolean };
  lead_returned?: { enabled?: boolean; silence_days?: number };
  scheduled_failed?: { enabled?: boolean };
  ai_error?: { enabled?: boolean };
  worker_down?: { enabled?: boolean };
  custom_conditions?: Array<{ key: string; trigger: 'status_change'; value: string; template: string }>;
};

export function getDefaultConfig(saved?: any) {
  const defaultEvents: TelegramEventConfig = {
    operator_needed: { enabled: true },
    channel_down: { enabled: true },
    ai_silent: { enabled: true, threshold_minutes: 5 },
    deal_won: { enabled: true },
    deal_lost: { enabled: false },
    new_lead: { enabled: true },
    contact_received: { enabled: true },
    repeat_touches_exhausted: { enabled: true },
    lead_returned: { enabled: true, silence_days: 7 },
    scheduled_failed: { enabled: true },
    ai_error: { enabled: true },
    worker_down: { enabled: true },
    custom_conditions: [],
  };

  return {
    recipients: Array.isArray(saved?.recipients) ? saved.recipients : [],
    ...(saved ?? {}),
    events: {
      ...defaultEvents,
      ...(saved?.events ?? {}),
      ...Object.fromEntries(
        Object.keys(defaultEvents)
          .filter((key) => key !== 'custom_conditions')
          .map((key) => [
            key,
            {
              ...defaultEvents[key as keyof TelegramEventConfig],
              ...(saved?.events?.[key as keyof TelegramEventConfig] ?? {}),
            },
          ])
      ),
      custom_conditions: saved?.events?.custom_conditions ?? [],
    },
  };
}

export function normalizeTelegramExtensionConfig(saved?: any) {
  return getDefaultConfig({
    ...(saved ?? {}),
    recipients: Array.isArray(saved?.recipients) ? saved.recipients : [],
    events: {
      ...(saved?.events ?? {}),
      new_message: {
        enabled: saved?.events?.new_message?.enabled ?? true,
        only_when_ai_paused: saved?.events?.new_message?.only_when_ai_paused ?? false,
      },
      help_request: {
        enabled: saved?.events?.help_request?.enabled ?? true,
      },
      custom_conditions: Array.isArray(saved?.events?.custom_conditions) ? saved.events.custom_conditions : [],
    },
  });
}
