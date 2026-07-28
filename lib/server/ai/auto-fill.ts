export interface AutoFilledFields {
  companyDescription: string;
  goal: string;
  advantages: string;
  targetAudience: string;
  firstQuestion: string;
  commonObjections: string[];
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

export function normalizeAutoFillPayload(payload: unknown): AutoFilledFields {
  const parsed = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;

  return {
    companyDescription: toStringValue(parsed.companyDescription),
    goal: toStringValue(parsed.goal),
    advantages: toStringValue(parsed.advantages),
    targetAudience: toStringValue(parsed.targetAudience),
    firstQuestion: toStringValue(parsed.firstQuestion),
    commonObjections: toStringArray(parsed.commonObjections),
  };
}

export function buildAutoFillPrompt(materials: string): string {
  return `You are a business analyst. Analyze the following business materials and extract key information.

MATERIALS:
${materials}

Extract and return ONLY raw JSON (no markdown, no backticks, start with {, end with }):
{
  "companyDescription": "2-3 sentence description of what this company does, in Russian",
  "goal": "The main goal for an AI sales agent for this business (e.g. 'Записать клиента на демо' or 'Продать продукт'), in Russian, max 60 chars",
  "advantages": "3 key advantages/USPs of this business separated by newlines, in Russian",
  "targetAudience": "Who this business serves, in Russian, concise and specific",
  "firstQuestion": "The best first qualifying question for the AI agent to ask this lead, in Russian",
  "commonObjections": ["typical objection 1", "typical objection 2", "typical objection 3"]
}

CRITICAL: Raw JSON only. No markdown. Start with { end with }.`;
}

function extractJsonObject(text: string): Record<string, unknown> {
  const codeFenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = codeFenceMatch ? codeFenceMatch[1] : text;
  const jsonStart = candidate.indexOf('{');
  const jsonEnd = candidate.lastIndexOf('}');

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    const trimmedText = candidate.trim();
    if (trimmedText.startsWith('{') && trimmedText.endsWith('}')) {
      console.warn('[auto-fill] Falling back to direct JSON.parse because balanced object scan did not yield a parseable payload');
      return JSON.parse(trimmedText);
    }
    throw new Error('No JSON object found');
  }

  return JSON.parse(candidate.slice(jsonStart, jsonEnd + 1));
}

export async function autoFillFromKnowledgeBase(
  agentId: string,
): Promise<AutoFilledFields> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY не задан');

  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: sources } = await admin
    .from('kb_sources')
    .select('raw_content, title, type')
    .eq('agent_id', agentId)
    .eq('status', 'done')
    .limit(5);

  if (!sources || sources.length === 0) {
    return normalizeAutoFillPayload({});
  }

  const combinedText = sources
    .map((s) => `[${s.title}]\n${(s.raw_content ?? '').slice(0, 1500)}`)
    .join('\n\n---\n\n');

  const prompt = buildAutoFillPrompt(combinedText);

  const models = ['gemini-2.5-flash', 'gemini-2.5-pro'];
  let lastError = '';

  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 32768 },
          }),
        },
      );

      if (!res.ok) {
        lastError = `${model}: ${res.status}`;
        continue;
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

      try {
        const parsed = extractJsonObject(text);
        return normalizeAutoFillPayload(parsed);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      continue;
    }
  }

  console.error('[auto-fill] All models failed:', lastError);
  return normalizeAutoFillPayload({});
}
