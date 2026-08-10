export interface HandoffConfig {
  enabled: boolean;
  triggers: {
    explicit_request: boolean;
    anger_complaint: boolean;
    no_answer_after_two_searches: boolean;
    asks_if_bot: boolean;
  };
  client_message: string;
  operator_message: string;
}

export const DEFAULT_HANDOFF_CONFIG: HandoffConfig = {
  enabled: true,
  triggers: {
    explicit_request: true,
    anger_complaint: true,
    no_answer_after_two_searches: true,
    asks_if_bot: false,
  },
  client_message: 'Подключаю сотрудника, он уже видит наш диалог',
  operator_message: 'Новый диалог требует внимания',
};

export function getEmptyResponseFallbackMessage(): string {
  return DEFAULT_HANDOFF_CONFIG.client_message;
}

export function normalizeHandoffConfig(value: unknown): HandoffConfig {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const triggersSource = (source.triggers && typeof source.triggers === 'object' ? source.triggers : {}) as Record<string, unknown>;

  return {
    enabled: Boolean(source.enabled ?? true),
    triggers: {
      explicit_request: Boolean(triggersSource.explicit_request ?? true),
      anger_complaint: Boolean(triggersSource.anger_complaint ?? true),
      no_answer_after_two_searches: Boolean(triggersSource.no_answer_after_two_searches ?? true),
      asks_if_bot: Boolean(triggersSource.asks_if_bot ?? false),
    },
    client_message: String(source.client_message ?? DEFAULT_HANDOFF_CONFIG.client_message),
    operator_message: String(source.operator_message ?? DEFAULT_HANDOFF_CONFIG.operator_message),
  };
}

export function buildHandoffPromptSection(config: HandoffConfig): string {
  // Handoff is handled as a tool; do not inject UI or operator rules into the system prompt.
  return '';
}

export function injectHandoffSection(systemPrompt: string, value: unknown): string {
  const normalized = normalizeHandoffConfig(value);
  const section = buildHandoffPromptSection(normalized);
  const regex = /<handoff_triggers>[\s\S]*?<\/handoff_triggers>/;

  if (regex.test(systemPrompt)) {
    return systemPrompt.replace(regex, section);
  }

  return `${systemPrompt}\n\n${section}`;
}
