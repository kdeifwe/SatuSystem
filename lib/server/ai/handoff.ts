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
    bullets.push('- Клиент явно просит человека или оператора');
  }
  if (normalized.triggers.anger_complaint) {
    bullets.push('- Клиент выражает злость, угрозы или жалоба на компанию');
  }
  bullets.push('- Вопрос требует действий вне твоих полномочий (возврат денег, договор, юридика)');
  if (normalized.triggers.no_answer_after_two_searches) {
    bullets.push('- Агент не нашёл ответ 2 раза подряд');
  }
  if (normalized.triggers.asks_if_bot) {
    bullets.push('- клиент спрашивает "ты бот?"');
  }

  const finalBullets = bullets.length > 0 ? bullets.join('\n') : '- авто-передача включена, но не активировано ни одного триггера';

  return `<handoff_triggers>\nНемедленно вызови redirectToOperator если:\n${finalBullets}\n\nПри вызове — сначала отправь клиенту сообщение: \"${normalized.client_message}\", потом вызывай redirectToOperator с причиной передачи.\nПередай оператору это уведомление: \"${normalized.operator_message}\"\n</handoff_triggers>`;
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
