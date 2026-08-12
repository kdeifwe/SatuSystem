export function sanitizeAgentReply(rawReply: unknown): string {
  if (typeof rawReply !== 'string') return '';
  let text = rawReply.trim();
  if (!text) return '';

  text = text.replace(/^```(?:\w+)?\s*/s, '').replace(/\s*```$/s, '').trim();
  return text;
}
