import type { LLMRequest, LLMResponse, LLMProvider } from '../llm-client';

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

function buildOpenAIBody(request: LLMRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
  };

  if (typeof request.temperature === 'number') {
    body.temperature = request.temperature;
  }

  if (typeof request.maxTokens === 'number') {
    body.max_tokens = request.maxTokens;
  }

  if (Array.isArray(request.tools) && request.tools.length > 0) {
    body.functions = request.tools;
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
    };
  }
}
