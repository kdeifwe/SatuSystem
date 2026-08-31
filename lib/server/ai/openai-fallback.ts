export function isOpenAIFallbackAllowed(): boolean {
  return process.env.ALLOW_OPENAI_FALLBACK === 'true';
}
