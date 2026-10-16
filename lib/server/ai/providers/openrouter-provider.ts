import type { LLMRequest, LLMResponse, LLMProvider, LLMResponseToolCall } from '../llm-client';

const OPENROUTER_URL = `${(process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '')}/chat/completions`;
const DEFAULT_MAX_TOKENS = 2048;
const REQUEST_TIMEOUT_MS = 60_000;

// Оркестратор передаёт tools в формате Gemini (functionDeclarations, типы в UPPERCASE).
// OpenRouter ждёт OpenAI-формат: { type: 'function', function: { name, description, parameters } }.
function convertSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} };
  const converted: any = {};
  converted.type = schema.type ? String(schema.type).toLowerCase() : 'object';
  if (schema.properties && typeof schema.properties === 'object') {
    converted.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [
        key,
        typeof value === 'object' && value !== null ? convertSchema(value) : value,
      ]),
    );
  }
  if (Array.isArray(schema.required)) converted.required = schema.required;
  if (Array.isArray(schema.enum)) converted.enum = schema.enum;
  if (typeof schema.description === 'string') converted.description = schema.description;
  if (schema.items && typeof schema.items === 'object') converted.items = convertSchema(schema.items);
  return converted;
}

function convertTools(tools: any[]): Array<{ type: 'function'; function: { name: string; description: string; parameters: any } }> {
  return tools
    .map((tool) => (tool?.functionDeclarations && Array.isArray(tool.functionDeclarations) ? tool.functionDeclarations : tool))
    .flat()
    .filter((tool: any) => tool && typeof tool.name === 'string')
    .map((tool: any) => {
      const parameters = tool.parameters ? convertSchema(tool.parameters) : { type: 'object', properties: {} };
      if (parameters.type !== 'object') parameters.type = 'object';
      if (!parameters.properties) parameters.properties = {};
      return {
        type: 'function' as const,
        function: {
          name: tool.name,
          description: typeof tool.description === 'string' ? tool.description : '',
          parameters,
        },
      };
    });
}

type ChatMessage = { role: 'user' | 'assistant'; content: string };

// Склеиваем подряд идущие реплики одной роли, убираем пустые, гарантируем user первым и последним
// (Claude за OpenRouter не принимает prefill и требует начинать с user).
function buildMessages(request: LLMRequest): { system: string; messages: ChatMessage[] } {
  const systemParts: string[] = [];
  const messages: ChatMessage[] = [];
  for (const message of request.messages) {
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (!content) continue;
    if (message.role === 'system') {
      systemParts.push(content);
      continue;
    }
    const role: 'user' | 'assistant' = message.role === 'assistant' ? 'assistant' : 'user';
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n\n${content}`;
    else messages.push({ role, content });
  }
  if (messages.length === 0 || messages[0].role !== 'user') messages.unshift({ role: 'user', content: '(начало диалога)' });
  if (messages[messages.length - 1].role !== 'user') messages.push({ role: 'user', content: 'Продолжай.' });
  return { system: systemParts.join('\n\n'), messages };
}

function mapFinishReason(reason: unknown): string | undefined {
  switch (reason) {
    case 'length':
      return 'MAX_TOKENS'; // оркестратор ориентируется на это значение (Gemini-формат)
    case 'content_filter':
      return 'SAFETY';
    case 'stop':
    case 'tool_calls':
    case 'function_call':
      return 'STOP';
    default:
      return typeof reason === 'string' ? reason.toUpperCase() : undefined;
  }
}

function stripJsonFences(text: string): string {
  return text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

export class OpenRouterProvider implements LLMProvider {
  public name = 'openrouter';

  isAvailable(): boolean {
    return Boolean(process.env.OPENROUTER_API_KEY);
  }

  private buildBody(request: LLMRequest, includeTemperature: boolean): Record<string, unknown> {
    const { system, messages } = buildMessages(request);

    let systemText = system;
    if (request.responseFormat === 'json' || request.jsonSchema) {
      systemText += '\n\nВерни ответ строго в формате JSON, без markdown-обёрток и пояснений вне JSON.';
      if (request.jsonSchema) systemText += `\nJSON Schema ответа:\n${JSON.stringify(request.jsonSchema)}`;
    }

    const finalMessages: Array<Record<string, unknown>> = [];
    if (systemText.trim()) {
      // Для моделей Anthropic кэшируем большой системный промпт агента (OpenRouter пробрасывает cache_control).
      const useCache = request.model.startsWith('anthropic/') && process.env.OPENROUTER_DISABLE_PROMPT_CACHE !== '1';
      finalMessages.push({
        role: 'system',
        content: useCache
          ? [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
          : systemText,
      });
    }
    finalMessages.push(...messages);

    const body: Record<string, unknown> = {
      model: request.model,
      messages: finalMessages,
      max_tokens: typeof request.maxTokens === 'number' && request.maxTokens > 0 ? request.maxTokens : DEFAULT_MAX_TOKENS,
    };

    if (includeTemperature && typeof request.temperature === 'number') {
      body.temperature = Math.min(2, Math.max(0, request.temperature));
    }

    if (Array.isArray(request.tools) && request.tools.length > 0) {
      const tools = convertTools(request.tools);
      if (tools.length > 0) {
        body.tools = tools;
        body.tool_choice = 'auto';
      }
    }

    // Приватность: OPENROUTER_DATA_COLLECTION=deny запрещает провайдерам хранить и обучаться на запросах.
    if (process.env.OPENROUTER_DATA_COLLECTION === 'deny') {
      body.provider = { data_collection: 'deny' };
    }

    return body;
  }

  private async post(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: any }> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY не задан');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Title': process.env.OPENROUTER_APP_NAME ?? 'Satu.AI',
    };
    if (process.env.OPENROUTER_SITE_URL) headers['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL;

    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    let data: any = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    return { ok: response.ok, status: response.status, data };
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    let result = await this.post(this.buildBody(request, true));

    // Часть моделей не принимает нестандартную temperature — повторяем без неё.
    if (!result.ok && result.status === 400) {
      const message = String(result.data?.error?.message ?? '').toLowerCase();
      if (message.includes('temperature') || message.includes('top_p')) {
        console.warn('[OPENROUTER] model rejected temperature, retrying without it', { model: request.model });
        result = await this.post(this.buildBody(request, false));
      }
    }

    // OpenRouter иногда отдаёт ошибку провайдера в теле ответа со статусом 200.
    if (result.ok && result.data?.error) {
      result = { ok: false, status: Number(result.data.error.code) || 502, data: result.data };
    }

    if (!result.ok) {
      const message = result.data?.error?.message ?? `OpenRouter API error ${result.status}`;
      const err = new Error(message) as Error & { status?: number };
      err.status = result.status;
      throw err;
    }

    const data = result.data;
    const choice = data?.choices?.[0];
    const message = choice?.message ?? {};

    let text = typeof message.content === 'string'
      ? message.content
      : Array.isArray(message.content)
        ? message.content.map((part: any) => (typeof part?.text === 'string' ? part.text : '')).join('')
        : '';
    text = text.trim();
    if (request.responseFormat === 'json' || request.jsonSchema) text = stripJsonFences(text);

    const toolCalls: LLMResponseToolCall[] = (Array.isArray(message.tool_calls) ? message.tool_calls : [])
      .filter((call: any) => call?.function && typeof call.function.name === 'string')
      .map((call: any) => {
        let args: Record<string, unknown> = {};
        try {
          const parsed = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments || '{}') : call.function.arguments;
          if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>;
        } catch {
          args = {};
        }
        return { name: call.function.name as string, args };
      });

    const promptTokens = Number(data?.usage?.prompt_tokens ?? 0);
    const completionTokens = Number(data?.usage?.completion_tokens ?? 0);

    return {
      text,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: Number(data?.usage?.total_tokens ?? promptTokens + completionTokens),
      },
      provider: this.name,
      toolCalls,
      finishReason: mapFinishReason(choice?.finish_reason),
      rawResponse: data,
    };
  }
}
