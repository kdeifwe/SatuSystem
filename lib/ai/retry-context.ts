export function buildRetryContents(
  baseContents: Array<Record<string, unknown>>,
  assistantParts: Array<Record<string, unknown>> | undefined,
  functionResponseParts: Array<Record<string, unknown>> | undefined,
): Array<Record<string, unknown>> {
  const retryContents = [...baseContents];

  if (Array.isArray(assistantParts) && assistantParts.length > 0) {
    retryContents.push({ role: 'model', parts: assistantParts });
  }

  if (Array.isArray(functionResponseParts) && functionResponseParts.length > 0) {
    retryContents.push({ role: 'user', parts: functionResponseParts });
  }

  return retryContents;
}

export function buildFinalSynthesisContents(
  baseContents: Array<Record<string, unknown>>,
  assistantParts: Array<Record<string, unknown>> | undefined,
  toolResults: Array<Record<string, unknown>> | undefined,
  userMessage: string,
): Array<Record<string, unknown>> {
  const retryContents = [...baseContents];

  if (Array.isArray(assistantParts) && assistantParts.length > 0) {
    retryContents.push({ role: 'model', parts: assistantParts });
  }

  if (Array.isArray(toolResults) && toolResults.length > 0) {
    const functionResponseParts = toolResults.map((result) => ({
      functionResponse: {
        name: typeof result?.name === 'string' ? result.name : 'unknown',
        response: result?.error ? { error: result.error } : { result: result.result },
      },
    }));

    retryContents.push({
      role: 'user',
      parts: [
        { text: `Клиент спрашивает: ${userMessage}` },
        ...functionResponseParts,
        { text: 'У тебя есть результаты поиска/инструментов выше. Сформулируй финальный ответ клиенту на языке текущего диалога, не вызывай больше инструменты. Отвечай одним коротким сообщением, без списков и без упоминания инструментов.' },
      ],
    });
  }

  return retryContents;
}
