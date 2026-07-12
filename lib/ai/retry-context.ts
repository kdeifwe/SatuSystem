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
