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
          description: 'ID лида из контекста диалога.',
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
  | 'getCurrentDate'
  | 'getMediaFiles'
  | 'update_lead_status'
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
