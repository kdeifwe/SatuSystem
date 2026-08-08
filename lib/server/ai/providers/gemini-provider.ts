import { geminiFetch } from '../gemini-client';
import type { LLMMessage, LLMRequest, LLMResponse, LLMProvider } from '../llm-client';

const DEFAULT_MAX_OUTPUT_TOKENS = 512;
const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash';

function buildGeminiBody(request: LLMRequest): Record<string, unknown> {
  const systemText = request.messages.find((message) => message.role === 'system')?.content ?? '';
  const contents = request.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role,
      parts: [{ text: message.content }],
    }));

  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: systemText }] },
    contents,
    generationConfig: {
      temperature: request.temperature ?? 0.7,
      topP: 0.9,
      maxOutputTokens: request.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    },
  };

  if (Array.isArray(request.tools) && request.tools.length > 0) {
    const firstTool = request.tools[0] as any;
    body.tools = Array.isArray(firstTool?.functionDeclarations)
      ? request.tools
      : [{ functionDeclarations: request.tools }];
    body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
  } else {
    body.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
  }

  return body;
}

function extractText(data: any): string {
  const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : undefined;
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  return parts
    .filter((part: any) => typeof part?.text === 'string')
    .map((part: any) => part.text)
    .join('\n')
    .trim();
}

function buildUsage(data: any): { promptTokens: number; completionTokens: number; totalTokens: number } {
  const usage = data?.candidates?.[0]?.usageMetadata ?? data?.usageMetadata ?? {};
  return {
    promptTokens: Number(usage?.promptTokenCount ?? usage?.prompt_tokens ?? 0),
    completionTokens: Number(usage?.candidatesTokenCount ?? usage?.candidates_tokens ?? 0),
    totalTokens: Number(usage?.totalTokenCount ?? usage?.total_token_count ?? 0),
  };
}

function isModelIssue(status: number | undefined, message: string): boolean {
  const normalized = message.toLowerCase();
  return status === 404 || /model not found|deprecated|not supported|does not support/i.test(normalized);
}

export class GeminiProvider implements LLMProvider {
  public name = 'gemini';

  isAvailable(): boolean {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model || GEMINI_FALLBACK_MODEL;
    const body = buildGeminiBody(request);

    let response: Response;
    try {
      response = await geminiFetch(model, 'generateContent', body);
    } catch (error: any) {
      const message = error?.message || String(error);
      if (isModelIssue(error?.status, message) && model !== GEMINI_FALLBACK_MODEL) {
        return this.generate({ ...request, model: GEMINI_FALLBACK_MODEL });
      }
      const err = new Error(message) as Error & { status?: number };
      err.status = error?.status;
      throw err;
    }

    if (!response.ok) {
      const text = await response.text();
      const message = `Gemini API error ${response.status}: ${text}`;
      if (isModelIssue(response.status, text) && model !== GEMINI_FALLBACK_MODEL) {
        return this.generate({ ...request, model: GEMINI_FALLBACK_MODEL });
      }
      const err = new Error(message) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    const text = extractText(data);
    const usage = buildUsage(data);

    return {
      text,
      usage,
      provider: this.name,
    };
  }
}
