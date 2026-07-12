import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function callGemini(apiKey: string, prompt: string, temperature = 0.4): Promise<string> {
  const models = ['gemini-2.5-flash', 'gemini-2.5-pro'];
  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature, maxOutputTokens: 8192 },
          }),
        }
      );
      if (!res.ok) {
        console.warn(`[improve] ${model} returned ${res.status}`);
        continue;
      }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      if (text.length > 10) return text;
    } catch (e) {
      console.warn(`[improve] ${model} error:`, e);
      continue;
    }
  }
  throw new Error('Все модели Gemini недоступны');
}

function extractJSON(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`JSON не найден в: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1));
}

export async function POST(
  req: NextRequest,
  { params }: { params: { agentId: string } }
) {
  const userSupabase = createUserClient();
  const { data: { user } } = await userSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const body = await req.json();
  const { feedback } = body;
  if (!feedback?.trim()) {
    return NextResponse.json({ error: 'Опишите что нужно изменить' }, { status: 400 });
  }

  const admin = getAdmin();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY не задан' }, { status: 500 });

  const { data: agent, error: agentError } = await admin
    .from('agents')
    .select('name, system_prompt_compiled, role, goal, communication_rules, tone_of_voice')
    .eq('id', params.agentId)
    .single();

  if (agentError || !agent) {
    return NextResponse.json({ error: 'Агент не найден' }, { status: 404 });
  }

  const currentPrompt = agent.system_prompt_compiled ??
    `Ты ${agent.name}. Роль: ${agent.role}. Цель: ${agent.goal}.`;

  try {
    // ШАГ 1: Критик — анализирует проблему и находит конкретные слабые места
    console.log('[improve] Step 1: Critic analysis...');
    const criticPrompt = `You are an expert AI sales agent prompt critic.

CURRENT AGENT PROMPT:
${currentPrompt}

USER COMPLAINT:
"${feedback}"

Your task: Deeply analyze WHY this problem occurs in the prompt.
Find the EXACT lines or sections causing this issue.

Return raw JSON only (no markdown):
{
  "root_cause": "exact reason why this problem exists in the prompt",
  "weak_sections": ["section1 that causes this", "section2 that causes this"],
  "specific_fixes_needed": ["fix1", "fix2", "fix3"],
  "severity": "critical|major|minor"
}`;

    const criticResponse = await callGemini(apiKey, criticPrompt, 0.3);
    const criticism = extractJSON(criticResponse);
    console.log('[improve] Critic found:', criticism.root_cause);

    // ШАГ 2: Генератор — создаёт улучшенный промпт на основе критики
    console.log('[improve] Step 2: Generating improved prompt...');
    const generatorPrompt = `You are an expert AI sales agent prompt engineer for CIS market (Kazakhstan/Russia).

CURRENT PROMPT TO IMPROVE:
${currentPrompt}

IDENTIFIED PROBLEMS:
- Root cause: ${criticism.root_cause}
- Weak sections: ${JSON.stringify(criticism.weak_sections)}
- Required fixes: ${JSON.stringify(criticism.specific_fixes_needed)}

USER FEEDBACK: "${feedback}"

IMPROVEMENT RULES:
1. Keep all existing good parts — only fix the identified problems
2. Make responses MORE HUMAN: short (1-2 sentences), casual, like texting a friend
3. Add specific examples of good vs bad responses for the problematic section
4. Use concrete behavioral instructions, not vague guidelines
5. Add "ЗАПРЕЩЕНО:" section with 5 specific things the agent must NEVER do
6. Add "ОБЯЗАТЕЛЬНО:" section with 5 things the agent MUST always do

Return raw JSON only (no markdown, start with {):
{
  "improved_prompt": "the complete improved system prompt in Russian",
  "changes_summary": "2-3 sentences in Russian describing what changed",
  "key_improvements": ["improvement1 in Russian", "improvement2", "improvement3"]
}`;

    const generatorResponse = await callGemini(apiKey, generatorPrompt, 0.5);
    const generated = extractJSON(generatorResponse);

    // ШАГ 3: Валидатор — проверяет что улучшение реально решает проблему
    console.log('[improve] Step 3: Validating improvement...');
    const validatorPrompt = `You are a strict QA validator for AI agent prompts.

ORIGINAL PROBLEM: "${feedback}"
PROPOSED IMPROVEMENT SUMMARY: "${generated.changes_summary}"

Does the improvement actually solve the stated problem?
Will the agent now behave differently in a better way?

Return raw JSON only:
{
  "is_valid": true,
  "confidence": 0.95,
  "validation_note": "brief note in Russian"
}`;

    let isValid = true;
    try {
      const validatorResponse = await callGemini(apiKey, validatorPrompt, 0.1);
      const validation = extractJSON(validatorResponse);
      isValid = validation.is_valid !== false;
      console.log('[improve] Validation:', validation.confidence, validation.validation_note);
    } catch {
      console.warn('[improve] Validation step failed, proceeding anyway');
    }

    return NextResponse.json({
      improved_prompt: generated.improved_prompt,
      changes_summary: generated.changes_summary,
      key_improvements: generated.key_improvements ?? [],
      criticism: {
        root_cause: criticism.root_cause,
        severity: criticism.severity,
      },
      is_valid: isValid,
      current_prompt: currentPrompt,
    });

  } catch (err) {
    const fullError = err instanceof Error ? err.message : String(err);
    console.error('[improve] Full error details:', fullError);
    // Return generic error message to user to prevent leaking internal system content
    return NextResponse.json({ 
      error: 'Не удалось обработать ответ ассистента. Попробуйте переформулировать запрос.' 
    }, { status: 500 });
  }
}
