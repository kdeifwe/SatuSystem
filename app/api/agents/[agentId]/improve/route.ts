import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import {
  buildCriticSchema,
  buildGeneratorSchema,
  buildValidatorSchema,
  callGeminiForImprove,
  extractJsonPayload,
  logFailedJsonParse,
} from '@/lib/server/ai/improve-agent';

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: { agentId: string } }
) {
  const userSupabase = createUserClient();
  const { data: { user } } = await userSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const body = await req.json();
  const feedback = typeof body?.feedback === 'string' ? body.feedback.trim() : '';
  if (!feedback) {
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
    console.log('[improve] Step 1: Critic analysis...');
    const criticPrompt = `You are an expert AI sales agent prompt critic.

CURRENT AGENT PROMPT:
${currentPrompt}

USER COMPLAINT:
"${feedback}"

Your task: deeply analyze why this problem occurs in the prompt and find the exact sections causing it.

Return ONLY a single valid JSON object matching this schema exactly:
{
  "root_cause": "exact reason why this problem exists in the prompt",
  "weak_sections": ["section1 that causes this", "section2 that causes this"],
  "specific_fixes_needed": ["fix1", "fix2", "fix3"],
  "severity": "critical|major|minor"
}

Rules:
- Return no markdown, no code fences, no extra commentary.
- Output must be parseable by JSON.parse.
- Do not wrap the response in quotes or explanation.`;

    const criticSystemInstruction = 'You are an expert AI sales agent prompt critic. Return ONLY a single valid JSON object matching the requested schema. No markdown, no code fences, no commentary.';
    const criticResponse = await callGeminiForImprove(
      apiKey,
      criticSystemInstruction,
      criticPrompt,
      0.3,
      buildCriticSchema(),
      {
        admin,
        agentId: params.agentId,
        feedback,
        phase: 'critic',
      }
    );

    let criticism: Record<string, unknown>;
    try {
      criticism = extractJsonPayload(criticResponse.text);
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError);
      console.error('[improve] Critic JSON parse failed:', message);
      await logFailedJsonParse(admin, {
        agentId: params.agentId,
        feedback,
        phase: 'critic',
        prompt: criticPrompt,
        model: 'gemini',
        latencyMs: 0,
        rawText: criticResponse.text,
        rawResponse: criticResponse.rawResponse ?? null,
        parseError: message,
      });
      throw parseError;
    }

    console.log('[improve] Critic found:', criticism.root_cause);

    console.log('[improve] Step 2: Generating improved prompt...');
    const generatorPrompt = `You are an expert AI sales agent prompt engineer for CIS market (Kazakhstan/Russia).

CURRENT PROMPT TO IMPROVE:
${currentPrompt}

IDENTIFIED PROBLEMS:
- Root cause: ${String(criticism.root_cause ?? '')}
- Weak sections: ${JSON.stringify(criticism.weak_sections ?? [])}
- Required fixes: ${JSON.stringify(criticism.specific_fixes_needed ?? [])}

USER FEEDBACK: "${feedback}"

IMPROVEMENT RULES:
1. Keep all existing good parts — only fix the identified problems.
2. Make responses MORE HUMAN: short (1-2 sentences), casual, like texting a friend.
3. Add concrete examples of good vs bad responses for the problematic section.
4. Use behavioral instructions, not vague guidelines.
5. Add "ЗАПРЕЩЕНО:" section with 5 specific things the agent must NEVER do.
6. Add "ОБЯЗАТЕЛЬНО:" section with 5 things the agent MUST always do.

Return ONLY a single valid JSON object matching this schema exactly:
{
  "improved_prompt": "the complete improved system prompt in Russian",
  "changes_summary": "2-3 sentences in Russian describing what changed",
  "key_improvements": ["improvement1 in Russian", "improvement2", "improvement3"]
}

Rules:
- Return no markdown, no code fences, no extra commentary.
- Output must be parseable by JSON.parse.
- Do not wrap the response in quotes or explanation.`;

    const generatorSystemInstruction = 'You are an expert AI sales agent prompt engineer. Return ONLY a single valid JSON object matching the requested schema. No markdown, no code fences, no commentary.';
    const generatorResponse = await callGeminiForImprove(
      apiKey,
      generatorSystemInstruction,
      generatorPrompt,
      0.5,
      buildGeneratorSchema(),
      {
        admin,
        agentId: params.agentId,
        feedback,
        phase: 'generator',
      }
    );

    let generated: Record<string, unknown>;
    try {
      generated = extractJsonPayload(generatorResponse.text);
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError);
      console.error('[improve] Generator JSON parse failed:', message);
      await logFailedJsonParse(admin, {
        agentId: params.agentId,
        feedback,
        phase: 'generator',
        prompt: generatorPrompt,
        model: 'gemini',
        latencyMs: 0,
        rawText: generatorResponse.text,
        rawResponse: generatorResponse.rawResponse ?? null,
        parseError: message,
      });
      throw parseError;
    }

    console.log('[improve] Step 3: Validating improvement...');
    const validatorPrompt = `You are a strict QA validator for AI agent prompts.

ORIGINAL PROBLEM: "${feedback}"
PROPOSED IMPROVEMENT SUMMARY: "${String(generated.changes_summary ?? '')}"

Does the improvement actually solve the stated problem?
Will the agent now behave differently in a better way?

Return ONLY a single valid JSON object matching this schema exactly:
{
  "is_valid": true,
  "confidence": 0.95,
  "validation_note": "brief note in Russian"
}

Rules:
- Return no markdown, no code fences, no extra commentary.
- Output must be parseable by JSON.parse.`;

    let isValid = true;
    try {
      const validatorSystemInstruction = 'You are a strict QA validator. Return ONLY a single valid JSON object matching the requested schema. No markdown, no code fences, no commentary.';
      const validatorResponse = await callGeminiForImprove(
        apiKey,
        validatorSystemInstruction,
        validatorPrompt,
        0.1,
        buildValidatorSchema(),
        {
          admin,
          agentId: params.agentId,
          feedback,
          phase: 'validator',
        }
      );
      const validation = extractJsonPayload(validatorResponse.text);
      isValid = validation.is_valid !== false;
      console.log('[improve] Validation:', validation.confidence, validation.validation_note);
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError);
      console.warn('[improve] Validation step failed, proceeding anyway:', message);
      await logFailedJsonParse(admin, {
        agentId: params.agentId,
        feedback,
        phase: 'validator',
        prompt: validatorPrompt,
        model: 'gemini',
        latencyMs: 0,
        rawText: '',
        rawResponse: null,
        parseError: message,
      });
    }

    return NextResponse.json({
      improved_prompt: typeof generated.improved_prompt === 'string' ? generated.improved_prompt : currentPrompt,
      changes_summary: typeof generated.changes_summary === 'string' ? generated.changes_summary : 'Изменения применены.',
      key_improvements: Array.isArray(generated.key_improvements)
        ? generated.key_improvements.filter((value): value is string => typeof value === 'string')
        : [],
      criticism: {
        root_cause: typeof criticism.root_cause === 'string' ? criticism.root_cause : '',
        severity: typeof criticism.severity === 'string' ? criticism.severity : 'major',
      },
      is_valid: isValid,
      current_prompt: currentPrompt,
    });
  } catch (err) {
    const fullError = err instanceof Error ? err.message : String(err);
    console.error('[improve] Full error details:', fullError);
    return NextResponse.json({
      error: 'Не удалось обработать ответ ассистента. Попробуйте переформулировать запрос.',
    }, { status: 500 });
  }
}
