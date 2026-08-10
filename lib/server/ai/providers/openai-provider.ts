import type { LLMRequest, LLMResponse, LLMProvider } from '../llm-client';
import { parseFinishReasonFromResponse, parseToolCallsFromResponse } from '../llm-client';

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

function convertSchemaForProvider(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {} };
  }

  const converted: any = {};

  if (schema.type) {
    converted.type = String(schema.type).toLowerCase();
  } else {
    converted.type = 'object';
  }

  if (schema.properties && typeof schema.properties === 'object') {
    converted.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [
        key,
        typeof value === 'object' && value !== null
          ? convertSchemaForProvider(value)
          : value,
      ]),
    );
  }

  if (Array.isArray(schema.required)) {
    converted.required = schema.required;
  }

  if (schema.enum && Array.isArray(schema.enum)) {
    converted.enum = schema.enum;
  }

  if (schema.description && typeof schema.description === 'string') {
    converted.description = schema.description;
  }

  if (schema.items && typeof schema.items === 'object') {
    converted.items = convertSchemaForProvider(schema.items);
  }

  return converted;
}

function convertToolsForProvider(tools: any[]): any[] {
  return tools
    .map((tool) => {
      if (tool?.functionDeclarations && Array.isArray(tool.functionDeclarations)) {
        return tool.functionDeclarations;
      }
      return tool;
    })
    .flat()
    .map((tool: any) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ? convertSchemaForProvider(tool.parameters) : { type: 'object', properties: {} },
    }));
}

function buildOpenAIBody(request: LLMRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
  };

  if (typeof request.temperature === 'number') {
    body.temperature = request.temperature;
  }

  if (typeof request.maxTokens === 'number') {
    const modelName = String(request.model ?? '').toLowerCase();
    const isCompletionModel = modelName.startsWith('o1') || modelName.startsWith('o3') || modelName.startsWith('gpt-5');
    body[isCompletionModel ? 'max_completion_tokens' : 'max_tokens'] = request.maxTokens;
  }

  if (Array.isArray(request.tools) && request.tools.length > 0) {
    body.tools = convertToolsForProvider(request.tools).map((fn: any) => ({
      type: 'function',
      function: fn,
    }));
    body.tool_choice = 'auto';
  }

  if (request.jsonSchema && typeof request.jsonSchema === 'object') {
    body.functions = [
      {
        name: 'response',
        description: 'Structured JSON response',
        parameters: convertSchemaForProvider(request.jsonSchema),
      },
    ];
    body.function_call = { name: 'response' };
  }

  return body;
}

function parseUsage(data: any) {
  const usage = data?.usage ?? {};
  return {
    promptTokens: Number(usage?.prompt_tokens ?? usage?.promptTokens ?? 0),
    completionTokens: Number(usage?.completion_tokens ?? usage?.completionTokens ?? 0),
    totalTokens: Number(usage?.total_tokens ?? usage?.totalTokens ?? 0),
  };
}

function parseText(data: any): string {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : undefined;
  const functionArgs = choice?.message?.function_call?.arguments ?? choice?.function_call?.arguments;
  if (typeof functionArgs === 'string' && functionArgs.trim().length > 0) {
    return functionArgs.trim();
  }

  const content = choice?.message?.content ?? choice?.text ?? '';
  return typeof content === 'string' ? content.trim() : '';
}

export class OpenAIProvider implements LLMProvider {
  public name = 'openai';

  isAvailable(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY не задан');
    }

    const response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildOpenAIBody(request)),
    });

    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message ?? `OpenAI API error ${response.status}`;
      const err = new Error(message) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }

    const text = parseText(data);
    return {
      text,
      usage: parseUsage(data),
      provider: this.name,
      toolCalls: parseToolCallsFromResponse(data),
      finishReason: parseFinishReasonFromResponse(data),
      rawResponse: data,
    };
  }
}
