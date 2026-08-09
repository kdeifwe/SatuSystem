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
  const normalized = normalizeHandoffConfig(config);
  const bullets: string[] = [];

  if (!normalized.enabled) {
    return `<handoff_triggers>\nАвто-передача отключена. Не вызывай redirectToOperator автоматически.\n</handoff_triggers>`;
  }

  if (normalized.triggers.explicit_request) {
    bullets.push('- Клиент явно просит человека или оператора (например: "дайте оператора", "хочу поговорить с человеком")');
  }
  if (normalized.triggers.anger_complaint) {
    bullets.push('- Клиент выражает сильную злость, угрозы или серьёзную жалобу на компанию');
  }
  if (normalized.triggers.no_answer_after_two_searches) {
    bullets.push('- Ты не нашёл ответ в базе знаний 2 раза подряд');
  }
  if (normalized.triggers.asks_if_bot) {
    bullets.push('- Клиент прямо спрашивает "ты бот?" или "ты ИИ?"');
  }

  const finalBullets = bullets.length > 0 ? bullets.join('\n') : '- авто-передача включена, но не активировано ни одного триггера';

  return `<handoff_triggers>\nПередавай разговор оператору ТОЛЬКО если:\n${finalBullets}\n\nВАЖНО: Не передавай оператору просто так. Если клиент задаёт обычный вопрос о товаре, цене, доставке — отвечай сам. Только если клиент явно требует человека или ситуация критична.\n\nПри вызове redirectToOperator:\n1. Сначала отправь клиенту сообщение: "${normalized.client_message}"\n2. Потом вызови redirectToOperator с причиной передачи\n3. Передай оператору: "${normalized.operator_message}"\n</handoff_triggers>`;
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
