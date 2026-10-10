import type { LLMMessage } from './llm-client';

type GeminiHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

function normalizeGeminiRole(role: unknown): 'user' | 'assistant' {
  return role === 'user' ? 'user' : 'assistant';
}

export function partsToText(parts: unknown): string {
  if (!Array.isArray(parts)) return '';

  return parts
    .map((part: Record<string, unknown>) => {
      if (typeof part?.text === 'string') return part.text;

      const functionCall = part.functionCall as { name?: unknown; args?: unknown } | undefined;
      if (functionCall && typeof functionCall.name === 'string') {
        const args = functionCall.args ?? {};
        return `[Вызов инструмента ${functionCall.name}: ${JSON.stringify(args).slice(0, 6000)}]`;
      }

      const functionResponse = part.functionResponse as { name?: unknown; response?: unknown } | undefined;
      if (functionResponse && typeof functionResponse.name === 'string') {
        const response = functionResponse.response ?? {};
        return `[Результат инструмента ${functionResponse.name}: ${JSON.stringify(response).slice(0, 6000)}]`;
      }

      return '';
    })
    .filter((text): text is string => typeof text === 'string' && text.length > 0)
    .join('\n');
}

export function normalizeGeminiContentsToLlmMessages(contents: Array<Record<string, unknown>>): LLMMessage[] {
  const normalized: LLMMessage[] = [];

  for (const content of contents) {
    if (typeof content?.role !== 'string') continue;
    const message: GeminiHistoryMessage = {
      role: normalizeGeminiRole(content.role),
      content: partsToText(content.parts),
    };
    if (message.content.trim().length > 0) {
      normalized.push({
        role: message.role,
        content: message.content,
      });
    }
  }

  return normalized;
}
