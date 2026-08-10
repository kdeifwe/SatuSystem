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
    description: `Выполняет семантический поиск по базе знаний компании. Вызывай перед любым утверждением о цене, товаре, характеристике, доставке или условиях. Не угадывай факты.`,
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
    name: 'redirectToOperator',
    description: `Передать разговор живому оператору. Используй ТОЛЬКО если клиент явно просит человека: 'дайте оператора', 'хочу поговорить с человеком', 'вы бот?'. Не используй просто так — сначала попробуй помочь сам.`,
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
  | 'updateLeadStatus'
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
