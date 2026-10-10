import type { LLMMessage } from './llm-client';

export function partsToText(parts: unknown): string {
  if (!Array.isArray(parts)) return '';

  return parts
    .map((part: any) => {
      if (typeof part?.text === 'string') return part.text;
      if (part?.functionCall) {
        const functionName = typeof part.functionCall.name === 'string' ? part.functionCall.name : 'unknown';
        const args = part.functionCall.args ?? {};
        return `[Вызов инструмента ${functionName}: ${JSON.stringify(args).slice(0, 6000)}]`;
      }
      if (part?.functionResponse) {
        const functionName = typeof part.functionResponse.name === 'string' ? part.functionResponse.name : 'unknown';
        const response = part.functionResponse.response ?? {};
        return `[Результат инструмента ${functionName}: ${JSON.stringify(response).slice(0, 6000)}]`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export function normalizeGeminiContentsToLlmMessages(contents: Array<Record<string, unknown>>): LLMMessage[] {
  return contents
    .filter((content) => typeof content?.role === 'string')
    .map((content) => ({
      role: content.role === 'user' ? 'user' : 'assistant',
      content: partsToText(content.parts),
    }))
    .filter((message) => message.content.trim().length > 0) as LLMMessage[];
}
