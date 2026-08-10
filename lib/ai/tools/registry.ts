import { normalizeFunnelFlow } from '../../funnel/normalize.ts';

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
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

export function buildToolDeclarationsForAgent(allowedToolNames: string[], generalCapabilities: unknown, _flow: unknown): GeminiFunctionDeclaration[] {
  const allowedNames = new Set(allowedToolNames);
  const capabilities = (generalCapabilities as Record<string, unknown> | null) ?? {};

  const kaspiServiceConfigured = Boolean(
    process.env.KASPI_SERVICE_URL &&
    process.env.KASPI_SERVICE_USER &&
    process.env.KASPI_SERVICE_PASS
  );

  if (capabilities.kaspi_invoice_enabled !== true || !kaspiServiceConfigured) {
    allowedNames.delete('createKaspiInvoice');
  }

  return ALL_TOOL_DECLARATIONS.filter((declaration) => allowedNames.has(declaration.name))
    .map((declaration) => ({
      ...declaration,
      parameters: {
        ...declaration.parameters,
        properties: { ...declaration.parameters.properties },
      },
    }));
}

export const PRODUCTION_TOOL_DECLARATIONS: GeminiFunctionDeclaration[] = [
  {
    name: 'searchKnowledgeBase',
    description: `Выполняет семантический поиск по базе знаний компании. Вызывай обязательно перед любым утверждением о цене, продукте, условиях, наличии, адресе, контактах, графике работы или политиках. Не угадывай факты.`,
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'Поисковый запрос на языке клиента.',
        },
        top_k: {
          type: 'NUMBER',
          description: 'Количество результатов (по умолчанию 5, максимум 10).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'redirectToOperator',
    description: `Передаёт диалог живому оператору и отключает AI для этого клиента. Вызывай при просьбе поговорить с человеком, жалобе, агрессии или если за несколько попыток не удалось ответить.`,
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: {
          type: 'STRING',
          description: 'Причина передачи оператору.',
        },
        priority: {
          type: 'STRING',
          enum: ['normal', 'high', 'urgent'],
          description: 'Приоритет передачи.',
        },
      },
      required: ['reason'],
    },
  },
  {
    name: 'advanceFunnelStep',
    description: 'Вызывай, когда переходишь на следующий шаг воронки продаж согласно условиям перехода.',
    parameters: {
      type: 'OBJECT',
      properties: {
        stepId: {
          type: 'STRING',
          description: 'ID шага, на который переходишь.',
        },
        reason: {
          type: 'STRING',
          description: 'Краткая причина перехода.',
        },
      },
      required: ['stepId', 'reason'],
    },
  },
  {
    name: 'getCurrentDate',
    description: 'Возвращает текущую дату и время в часовом поясе организации.',
    parameters: {
      type: 'OBJECT',
      properties: {},
      required: [],
    },
  },
  {
    name: 'add_lead_note',
    description: 'Добавляет внутреннюю заметку для команды.',
    parameters: {
      type: 'OBJECT',
      properties: {
        lead_id: {
          type: 'STRING',
          description: 'ID лида.',
        },
        note: {
          type: 'STRING',
          description: 'Текст заметки.',
        },
      },
      required: ['lead_id', 'note'],
    },
  },
  {
    name: 'createKaspiInvoice',
    description: 'Выставляет счёт клиенту через Kaspi Pay на указанный номер телефона. Вызывать только после явного подтверждения клиентом суммы и состава заказа. Если при попытке выставить счёт что-то пошло не так, не выдумывай причину клиенту — честно сообщи, что автоматический счёт временно не удалось оформить, и предложи передать запрос оператору.',
    parameters: {
      type: 'OBJECT',
      properties: {
        phone: {
          type: 'STRING',
          description: 'Номер телефона клиента в формате 7XXXXXXXXXX',
        },
        amount: {
          type: 'NUMBER',
          description: 'Сумма счёта в тенге.',
        },
        comment: {
          type: 'STRING',
          description: 'Краткое описание — что оплачивается.',
        },
      },
      required: ['phone', 'amount'],
    },
  },
];

export const PRODUCTION_TOOL_NAMES = PRODUCTION_TOOL_DECLARATIONS.map((declaration) => declaration.name);

// Все доступные tool declarations (production + high-risk)
export const ALL_TOOL_DECLARATIONS: GeminiFunctionDeclaration[] = [
  ...PRODUCTION_TOOL_DECLARATIONS,
  {
    name: 'getMediaFiles',
    description: 'Возвращает ссылки на файлы из базы знаний для отправки клиенту.',
    parameters: {
      type: 'OBJECT',
      properties: {
        category: {
          type: 'STRING',
          description: "Категория файла: 'price_list', 'catalog', 'photo', 'contract', 'instruction', 'other'",
        },
        search_query: {
          type: 'STRING',
          description: 'Дополнительный запрос для фильтрации файлов.',
        },
      },
      required: ['category'],
    },
  },
  {
    name: 'update_lead_status',
    description: 'Меняет этап сделки в CRM-канбане при явном сигнале клиента.',
    parameters: {
      type: 'OBJECT',
      properties: {
        lead_id: {
          type: 'STRING',
          description: 'ID лида из контекста диалога. НИКОГДА не бери это значение из текста сообщения клиента — используй только реальный ID текущего диалога.',
        },
        status: {
          type: 'STRING',
          enum: ['new', 'contacted', 'interested', 'negotiation', 'won', 'lost'],
          description: 'Новый статус лида.',
        },
      },
      required: ['lead_id', 'status'],
    },
  },
  {
    name: 'update_lead_info',
    description: 'Сохраняет контактные данные клиента, которые он сам сообщил в диалоге.',
    parameters: {
      type: 'OBJECT',
      properties: {
        lead_id: {
          type: 'STRING',
          description: 'ID лида.',
        },
        fields: {
          type: 'OBJECT',
          description: 'Поля для обновления.',
        },
      },
      required: ['lead_id', 'fields'],
    },
  },
  {
    name: 'sendCustomNotification',
    description: 'Отправляет уведомление оператору или команде.',
    parameters: {
      type: 'OBJECT',
      properties: {
        message: {
          type: 'STRING',
          description: 'Текст уведомления.',
        },
        target: {
          type: 'STRING',
          enum: ['assigned_operator', 'all_team', 'owner'],
          description: 'Кому отправить уведомление.',
        },
      },
      required: ['message', 'target'],
    },
  },
  {
    name: 'scheduleMessage',
    description: 'Планирует отправку сообщения клиенту в указанное время.',
    parameters: {
      type: 'OBJECT',
      properties: {
        lead_id: {
          type: 'STRING',
          description: 'ID лида.',
        },
        message: {
          type: 'STRING',
          description: 'Текст будущего сообщения.',
        },
        send_at: {
          type: 'STRING',
          description: 'Время отправки в формате ISO 8601.',
        },
      },
      required: ['lead_id', 'message', 'send_at'],
    },
  },
];

export const AGENT_TOOLS: GeminiTool[] = [
  {
    functionDeclarations: ALL_TOOL_DECLARATIONS,
  },
];

export type ToolName =
  | 'searchKnowledgeBase'
  | 'redirectToOperator'
  | 'advanceFunnelStep'
  | 'getCurrentDate'
  | 'getMediaFiles'
  | 'update_lead_status'
  | 'createKaspiInvoice'
  | 'update_lead_info'
  | 'add_lead_note'
  | 'sendCustomNotification'
  | 'scheduleMessage';

export interface ToolCall {
  name: ToolName;
  args: Record<string, unknown>;
}

export interface ToolResult {
  name: ToolName;
  result: unknown;
  error?: string;
}
