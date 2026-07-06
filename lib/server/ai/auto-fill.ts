export interface AutoFilledFields {
  companyDescription: string;
  goal: string;
  advantages: string;
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
    return {
      companyDescription: '',
      goal: '',
      advantages: '',
    };
  }

  const combinedText = sources
    .map((s) => `[${s.title}]\n${(s.raw_content ?? '').slice(0, 1500)}`)
    .join('\n\n---\n\n');

  const prompt = `You are a business analyst. Analyze the following business materials and extract key information.

MATERIALS:
${combinedText}

Extract and return ONLY raw JSON (no markdown, no backticks, start with {, end with }):
{
  "companyDescription": "2-3 sentence description of what this company does, in Russian",
  "goal": "The main goal for an AI sales agent for this business (e.g. 'Записать клиента на демо' or 'Продать продукт'), in Russian, max 60 chars",
  "advantages": "3 key advantages/USPs of this business separated by newlines, in Russian"
}

CRITICAL: Raw JSON only. No markdown. Start with { end with }.`;

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
            generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
          }),
        },
      );

      if (!res.ok) {
        lastError = `${model}: ${res.status}`;
        continue;
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) continue;

      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      return {
        companyDescription: parsed.companyDescription || '',
        goal: parsed.goal || '',
        advantages: parsed.advantages || '',
      };
    } catch (e) {
      lastError = String(e);
      continue;
    }
  }

  console.error('[auto-fill] All models failed:', lastError);
  return { companyDescription: '', goal: '', advantages: '' };
}
