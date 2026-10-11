type ToolCallMatch = {
  name: string;
  args: Record<string, unknown>;
  start: number;
  end: number;
};

function findToolCallMatches(text: string): ToolCallMatch[] {
  if (typeof text !== 'string' || text.length === 0) return [];

  const matches: ToolCallMatch[] = [];
  const markerPattern = /\[(?:Вызов|Результат)\s+инструмента\s+([A-Za-z0-9_]+)\s*:\s*/gi;
  let match: RegExpExecArray | null;

  while ((match = markerPattern.exec(text)) !== null) {
    const name = match[1];
    const payloadStart = match.index + match[0].length;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let payloadEnd = -1;

    for (let i = payloadStart; i < text.length; i += 1) {
      const char = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          payloadEnd = i + 1;
          break;
        }
      }
    }

    const end = payloadEnd > payloadStart ? payloadEnd + 1 : text.length;
    const jsonText = payloadEnd > payloadStart ? text.slice(payloadStart, payloadEnd) : '{}';

    if (payloadEnd <= payloadStart) {
      matches.push({ name, args: {}, start: match.index, end: text.length });
      break;
    }

    try {
      const parsed = JSON.parse(jsonText);
      matches.push({
        name,
        args: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {},
        start: match.index,
        end,
      });
    } catch {
      matches.push({ name, args: {}, start: match.index, end });
    }

    markerPattern.lastIndex = end;
  }

  return matches;
}

export function extractTextToolCalls(text: string): Array<{ name: string; args: Record<string, unknown> }> {
  if (typeof text !== 'string') return [];
  return findToolCallMatches(text).map(({ name, args }) => ({ name, args }));
}

export function sanitizeAgentReply(rawReply: unknown): string {
  if (typeof rawReply !== 'string') return '';
  let text = rawReply.trim();
  if (!text) return '';

  text = text.replace(/^```(?:\w+)?\s*/s, '').replace(/\s*```$/s, '').trim();
  if (!text) return '';

  const matches = findToolCallMatches(text).slice().reverse();
  for (const match of matches) {
    const before = text.slice(0, match.start);
    const after = text.slice(match.end);
    text = `${before}${after}`;
  }

  text = text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\]\n+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();

  return text;
}
