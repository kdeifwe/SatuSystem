import { normalizeFunnelFlow } from '../../funnel/normalize.ts';
import { MEDIA_CATEGORIES } from '../../media/categories.ts';

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

function buildSendMediaDeclaration(availableCategories: string[]): GeminiFunctionDeclaration | null {
  const cats = Array.isArray(availableCategories) ? availableCategories.map((c) => String(c).trim()).filter(Boolean) : [];
  const matched = MEDIA_CATEGORIES.filter((mc) => cats.includes(mc.id));
  if (matched.length === 0) return null;

  const enumValues = matched.map((m) => m.id);

  const categoryProperty: Record<string, unknown> = {
    type: 'STRING',
    description: `Категория медиа. Доступные значения: ${matched.map((m) => `${m.label} (${m.id})`).join(', ')}`,
  };

  if (enumValues.length > 0) categoryProperty.enum = enumValues;

  return {
    name: 'sendMediaToClient',
    description: 'Отправляет клиенту файл из указанной категории из базы знаний агента.',
    parameters: {
      type: 'OBJECT',
      properties: {
        category: categoryProperty,
        caption: { type: 'STRING', description: 'Подпись/комментарий для отправляемого файла.' },
      },
      required: ['category'],
    },
  };
}

export interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[];
}

function normalizeToolNameList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

export function mergeAllowedToolNames(
  configuredTools: unknown,
  defaultTools: unknown,
  _options?: { includeAdvanceFunnelStep?: boolean },
): string[] {
  const merged = new Set<string>();
  const normalizedExisting = normalizeToolNameList(configuredTools);
  const normalizedDefaults = normalizeToolNameList(defaultTools);

  if (normalizedExisting.length === 0 && normalizedDefaults.length === 0) {
    return ALL_TOOL_DECLARATIONS.map((declaration) => declaration.name);
  }

  for (const tool of normalizedExisting) {
    if (tool) merged.add(tool);
  }

  for (const tool of normalizedDefaults) {
    if (tool) merged.add(tool);
  }

  return Array.from(merged);
}

function buildAdvanceFunnelStepDeclaration(flow: unknown): GeminiFunctionDeclaration {
  const stepIds = (normalizeFunnelFlow(flow)?.nodes ?? [])
    .map((node) => typeof node?.id === 'string' ? node.id.trim() : '')
    .filter(Boolean);

  const stepIdProperty: Record<string, unknown> = {
    type: 'STRING',
    description: stepIds.length > 0
      ? `ID шага, на который переходишь. Доступные значения: ${stepIds.join(', ')}`
      : 'ID шага, на который переходишь.',
  };

  if (stepIds.length > 0) {
    stepIdProperty.enum = stepIds;
  }

  return {
    name: 'advanceFunnelStep',
    description: 'Вызывай, когда переходишь на следующий шаг воронки продаж согласно условиям перехода.',
    parameters: {
      type: 'OBJECT',
      properties: {
        stepId: stepIdProperty,
        reason: {
          type: 'STRING',
          description: 'Краткая причина перехода.',
        },
      },
      required: ['stepId', 'reason'],
    },
  };
}

export function buildToolDeclarationsForAgent(
  allowedToolNames: string[],
  generalCapabilities: unknown,
  _flow: unknown,
  availableMediaCategories: string[] = [],
): GeminiFunctionDeclaration[] {
  function normalizeToolName(name: string): string {
    return String(name).replace(/[^a-z0-9]+/gi, '').toLowerCase();
  }

  const allowedNames = new Set(allowedToolNames);
  const normalizedAllowed = new Set(Array.from(allowedNames).map((n) => normalizeToolName(n)));
  const capabilities = (generalCapabilities as Record<string, unknown> | null) ?? {};

  const kaspiServiceConfigured = Boolean(
    process.env.KASPI_SERVICE_URL &&
    process.env.KASPI_SERVICE_USER &&
    process.env.KASPI_SERVICE_PASS
  );

  if (capabilities.kaspi_invoice_enabled !== true || !kaspiServiceConfigured) {
    allowedNames.delete('createKaspiInvoice');
    allowedNames.delete('sendKaspiPay');
  }

  const decls = ALL_TOOL_DECLARATIONS.filter((declaration) => normalizedAllowed.has(normalizeToolName(declaration.name)))
    .map((declaration) => ({
      ...declaration,
      parameters: {
        ...declaration.parameters,
        properties: { ...declaration.parameters.properties },
      },
    }));

  // If funnel step advance is allowed, build a dynamic declaration from the flow
  const advanceNormalized = normalizeToolName('advanceFunnelStep');
  if (normalizedAllowed.has(advanceNormalized)) {
    try {
      const adv = buildAdvanceFunnelStepDeclaration(_flow);
      // Avoid duplicates
      if (!decls.find((d) => d.name === adv.name)) decls.push(adv);
    } catch (e) {
      console.warn('[TOOLS] Failed to build advanceFunnelStep declaration', e);
    }
  }

  // If sendMediaToClient is allowed and we have available media categories, build a dynamic declaration
  const sendMediaNormalized = normalizeToolName('sendMediaToClient');
  if (normalizedAllowed.has(sendMediaNormalized)) {
    try {
      if (Array.isArray(availableMediaCategories) && availableMediaCategories.length > 0) {
        const sendDecl = buildSendMediaDeclaration(availableMediaCategories);
        // buildSendMediaDeclaration may return null if none of the available categories
        // match known MEDIA_CATEGORIES — in that case do not add the tool.
        if (sendDecl) {
          if (!decls.find((d) => d.name === sendDecl.name)) decls.push(sendDecl);
        } else {
          const idx = decls.findIndex((d) => d.name === 'sendMediaToClient');
          if (idx !== -1) decls.splice(idx, 1);
        }
      } else {
        // If allowed but there are no categories, ensure tool is not present
        const idx = decls.findIndex((d) => d.name === 'sendMediaToClient');
        if (idx !== -1) decls.splice(idx, 1);
      }
    } catch (e) {
      console.warn('[TOOLS] Failed to build sendMediaToClient declaration', e);
    }
  }

  // Also include scheduleMessage/getCurrentDate if requested (executor implements them)
  // (They will be matched via normalized names)

  return decls;
}

export const PRODUCTION_TOOL_DECLARATIONS: GeminiFunctionDeclaration[] = [
  {
    name: 'searchKnowledgeBase',
    description: `Выполняет семантический поиск по базе знаний компании. Используй ТОЛЬКО если нужный факт отсутствует в твоей памяти (CORE_KNOWLEDGE) или инструкциях выше. Не вызывай для цены, продукта, условий, FAQ и возражений, если они уже описаны в CORE_KNOWLEDGE. Не угадывай факты.`,
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Поисковый запрос на языке клиента.' },
        top_k: { type: 'NUMBER', description: 'Количество результатов (по умолчанию 5).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'sendKaspiPay',
    description: `Отправить клиенту счёт через Kaspi Pay. Используй ТОЛЬКО после явного подтверждения покупки и согласия клиента на сумму. Не отправляй счёт без подтверждения.`,
    parameters: {
      type: 'OBJECT',
      properties: {
        phone: { type: 'STRING', description: 'Номер телефона клиента в формате 7XXXXXXXXXX' },
        amount: { type: 'NUMBER', description: 'Сумма счёта в тенге.' },
        comment: { type: 'STRING', description: 'Комментарий к счёту.' },
      },
      required: ['phone', 'amount'],
    },
  },
  {
    name: 'scheduleMessage',
    description: 'Запланировать отправку сообщения клиенту в указанное время. ИСПОЛЬЗУЙ ТОЛЬКО когда нужно отправить follow-up или напоминание; не используйте для немедленных ответов.',
    parameters: {
      type: 'OBJECT',
      properties: {
        message: { type: 'STRING', description: 'Текст сообщения для отправки.' },
        send_at: { type: 'STRING', description: 'UTC-время отправки в ISO 8601 формате.' },
      },
      required: ['message', 'send_at'],
    },
  },
  {
    name: 'updateLeadStatus',
    description: 'Обновляет статус лида в CRM (new, contacted, interested, negotiation, won, lost). Вызывай при явном событии: клиент согласился, отказался или дал критичную информацию.',
    parameters: {
      type: 'OBJECT',
      properties: {
        lead_id: { type: 'STRING', description: 'ID лида из контекста диалога.' },
        status: { type: 'STRING', enum: ['new', 'contacted', 'interested', 'negotiation', 'won', 'lost'], description: 'Новый статус лида.' },
      },
      required: ['lead_id', 'status'],
    },
  },
  {
    name: 'update_lead_info',
    description: 'Обновляет свойства лида (имя, email, телефон и др.). ИСПОЛЬЗУЙ ТОЛЬКО когда нужно изменить структурированные поля лида или его контактную информацию. Не изменяй статус лида с помощью этого инструмента (используй updateLeadStatus для смены статуса). Сервер использует ID лида из контекста диалога; не передавай lead_id в аргументах.',
    parameters: {
      type: 'OBJECT',
      properties: {
        fields: { type: 'OBJECT', description: 'Объект с парами ключ:значение для обновления (напр., name, phone, email и т.д.).' },
      },
      required: ['fields'],
    },
  },
  {
    name: 'add_lead_note',
    description: 'Добавляет текстовую заметку в `lead_notes`. ИСПОЛЬЗУЙ ТОЛЬКО для записи заметок/комментариев. Сервер использует ID лида из контекста диалога; не передавай lead_id в аргументах. Заметки должны соответствовать Spec.md раздел 3 и сохраняться в lead_notes.',
    parameters: {
      type: 'OBJECT',
      properties: {
        note: { type: 'STRING', description: 'Текст заметки, кратко и по делу.' },
      },
      required: ['note'],
    },
  },
  {
    name: 'redirectToOperator',
    description: `Передать разговор живому оператору. ИСПОЛЬЗУЙ ТОЛЬКО если клиент явно просит человека фразами: "дайте оператора", "хочу поговорить с человеком", "переключите на оператора", "нужен живой сотрудник". ЗАПРЕЩЕНО вызывать этот инструмент если ты не знаешь цену, характеристику товара или условия доставки. В случае отсутствия знаний ответь клиенту из CORE_KNOWLEDGE или скажи "Сейчас уточню информацию и вернусь с ответом".`,
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: { type: 'STRING', description: 'Краткая причина передачи.' },
        priority: { type: 'STRING', enum: ['normal', 'high', 'urgent'], description: 'Приоритет передачи.' },
      },
      required: ['reason'],
    },
  },
];

export const PRODUCTION_TOOL_NAMES = PRODUCTION_TOOL_DECLARATIONS.map((declaration) => declaration.name);

// Все доступные tool declarations (production + high-risk)
export const ALL_TOOL_DECLARATIONS: GeminiFunctionDeclaration[] = [
  ...PRODUCTION_TOOL_DECLARATIONS,
];

export const AGENT_TOOLS: GeminiTool[] = [
  {
    functionDeclarations: PRODUCTION_TOOL_DECLARATIONS,
  },
];

export type ToolName =
  | 'searchKnowledgeBase'
  | 'sendKaspiPay'
  | 'sendMediaToClient'
  | 'updateLeadStatus'
  | 'advanceFunnelStep'
  | 'scheduleMessage'
  | 'update_lead_info'
  | 'add_lead_note'
  | 'redirectToOperator';

export interface ToolCall {
  name: ToolName;
  args: Record<string, unknown>;
}

export interface ToolResult {
  name: ToolName;
  result: unknown;
  error?: string;
}
