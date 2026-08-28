import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import {
  applyPromptPatches,
  buildCriticSchema,
  buildGeneratorSchema,
  buildValidatorSchema,
  callOpenAIForImproveWithRetry,
  type PromptPatch,
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
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) return NextResponse.json({ error: 'OPENAI_API_KEY не задан' }, { status: 500 });

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

  // Fetch recent example dialogues for this agent to provide concrete failure examples to the critic.
  // Use the canonical schema from migrations: conversations(id, agent_id, started_at) and messages(conversation_id, sender, content, created_at)
  let exampleDialoguesText = '';
  try {
    const { data: recentConvs } = await admin
      .from('conversations')
      .select('id')
      .eq('agent_id', params.agentId)
      .order('started_at', { ascending: false })
      .limit(3);

    const convIds = Array.isArray(recentConvs) ? recentConvs.map((c: any) => c.id).filter(Boolean) : [];
    if (convIds.length > 0) {
      const { data: msgs } = await admin
        .from('messages')
        .select('conversation_id, sender, content, created_at')
        .in('conversation_id', convIds)
        .order('created_at', { ascending: false })
        .limit(50);

      if (Array.isArray(msgs) && msgs.length > 0) {
        const grouped: Record<string, any[]> = {};
        for (const m of msgs) {
          if (!grouped[m.conversation_id]) grouped[m.conversation_id] = [];
          grouped[m.conversation_id].push(m);
        }

        let idx = 1;
        for (const cid of convIds) {
          const bucket = grouped[cid] ?? [];
          if (bucket.length === 0) continue;
          // take up to 3 most recent messages and reverse to chronological order
          const slice = bucket.slice(0, 3).reverse();
          exampleDialoguesText += `--- Conversation ${idx} ---\n`;
          for (const m of slice) {
            const role = m.sender === 'ai' ? 'Agent' : m.sender === 'user' ? 'User' : String(m.sender);
            const content = (m.content ?? '').replace(/\n/g, ' ');
            exampleDialoguesText += `${role}: ${content}\n`;
          }
          exampleDialoguesText += '\n';
          idx += 1;
        }
      }
    }
  } catch (e) {
    // Non-fatal: if we can't fetch examples, proceed without them
    console.warn('[improve] failed to fetch example dialogues for critic', e);
  }

  try {
    console.log('[improve] Step 1: Critic analysis...');
    let criticExamplesSection = '';
    if (exampleDialoguesText && exampleDialoguesText.trim().length > 0) {
      criticExamplesSection = `\n\nEXAMPLE DIALOGUES:\n${exampleDialoguesText}`;
    }

    const criticPrompt = `You are an expert AI sales agent prompt critic.

CURRENT AGENT PROMPT:
${currentPrompt}

USER COMPLAINT:
"${feedback}"
${criticExamplesSection}

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
      const criticValidate = (obj: unknown) => {
        if (!obj || typeof obj !== 'object') return false;
        const o = obj as Record<string, unknown>;
        if (typeof o.root_cause !== 'string') return false;
        if (!Array.isArray(o.weak_sections)) return false;
        if (!Array.isArray(o.specific_fixes_needed)) return false;
        if (typeof o.severity !== 'string') return false;
        return true;
      };

const criticResult = await callOpenAIForImproveWithRetry(
        criticSystemInstruction,
        criticPrompt,
        0.3,
        buildCriticSchema(),
        {
          admin,
          agentId: params.agentId,
          feedback,
          phase: 'critic',
        },
        criticValidate,
        3
      );

      const criticism = criticResult.parsedJson;

    console.log('[improve] Critic found:', criticism.root_cause);

    console.log('[improve] Step 2: Generating minimal prompt patches...');
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
2. Return a MINIMAL set of targeted search/replace patches on the existing prompt.
3. Do NOT rewrite the whole prompt from scratch.
4. Each patch should edit one specific section or add one specific instruction.
5. The search fragment must be a sufficiently long and unique snippet from the current prompt so it matches exactly once.
6. Use raw text search/replace blocks, not unified diff format.
7. Add concrete examples of good vs bad responses for the problematic section.
8. Keep the tone human, short, and practical.

Return ONLY a single valid JSON object matching this schema exactly:
{
  "patches": [{"search": "short unique snippet from the existing prompt", "replace": "new inserted or replacement text", "reason": "why this patch is needed"}],
  "changes_summary": "2-3 sentences in Russian describing what changed",
  "key_improvements": ["improvement1 in Russian", "improvement2", "improvement3"]
}

Rules:
- Return no markdown, no code fences, no extra commentary.
- Output must be parseable by JSON.parse.
- Do not wrap the response in quotes or explanation.`;

    const generatorSystemInstruction = 'You are an expert AI sales agent prompt engineer. Return ONLY a single valid JSON object matching the requested schema. No markdown, no code fences, no commentary.';
    const generatorValidate = (obj: unknown) => {
      if (!obj || typeof obj !== 'object') return false;
      const o = obj as Record<string, unknown>;
      if (!Array.isArray(o.patches)) return false;
      const patches = o.patches as unknown[];
      for (const p of patches) {
        if (!p || typeof p !== 'object') return false;
        const pp = p as Record<string, unknown>;
        if (typeof pp.search !== 'string' || typeof pp.replace !== 'string' || typeof pp.reason !== 'string') return false;
      }
      return true;
    };

    const generatorResult = await callOpenAIForImproveWithRetry(
      generatorSystemInstruction,
      generatorPrompt,
      0.5,
      buildGeneratorSchema(),
      {
        admin,
        agentId: params.agentId,
        feedback,
        phase: 'generator',
      },
      generatorValidate,
      3
    );

    const generated = generatorResult.parsedJson;

    let patches = Array.isArray(generated.patches)
      ? generated.patches.filter((value): value is PromptPatch => Boolean(value) && typeof value === 'object' && typeof (value as PromptPatch).search === 'string' && typeof (value as PromptPatch).replace === 'string' && typeof (value as PromptPatch).reason === 'string')
      : [];

    if (patches.length === 0) {
      throw new Error('Generator did not return any prompt patches');
    }

    let proposedPrompt: string;
    try {
      proposedPrompt = applyPromptPatches(currentPrompt, patches);
    } catch (patchError) {
      const message = patchError instanceof Error ? patchError.message : String(patchError);

      // If failure is due to search fragment mismatch, attempt one retry by asking the generator
      // to produce corrected patches or a full improved_prompt fallback. This prevents immediate
      // failure when the generator quoted the prompt slightly differently (whitespace/quotes/etc).
      if (/search fragment must appear exactly once|search fragment must not be empty/i.test(message)) {
        console.warn('[improve] Patch application failed, attempting one retry with generator feedback:', message);
        const failureNote = `NOTE: Applying the previously generated patches failed because at least one 'search' fragment did not match the current prompt exactly. Current prompt:\n${currentPrompt}\n\nFailed patches:\n${JSON.stringify(patches, null, 2)}\n\nPlease return either corrected patches that will apply unambiguously, or return a single field \"improved_prompt\" with the full updated prompt.`;
        const retryPrompt = `${generatorPrompt}\n\n${failureNote}`;

        const retryValidate = (obj: unknown) => {
          if (!obj || typeof obj !== 'object') return false;
          const o = obj as Record<string, unknown>;
          if (Array.isArray(o.patches)) {
            for (const p of o.patches as unknown[]) {
              if (!p || typeof p !== 'object') return false;
              const pp = p as Record<string, unknown>;
              if (typeof pp.search !== 'string' || typeof pp.replace !== 'string' || typeof pp.reason !== 'string') return false;
            }
            return true;
          }
          if (typeof o.improved_prompt === 'string' && o.improved_prompt.trim().length > 0) return true;
          return false;
        };

        const retryResult = await callOpenAIForImproveWithRetry(
          generatorSystemInstruction,
          retryPrompt,
          0.5,
          buildGeneratorSchema(),
          {
            admin,
            agentId: params.agentId,
            feedback,
            phase: 'generator',
          },
          retryValidate,
          1
        );

        const retryParsed = retryResult.parsedJson;
        if (Array.isArray(retryParsed.patches) && retryParsed.patches.length > 0) {
          const newPatches = retryParsed.patches as PromptPatch[];
          try {
            proposedPrompt = applyPromptPatches(currentPrompt, newPatches);
            patches = newPatches;
          } catch (secondErr) {
            const m2 = secondErr instanceof Error ? secondErr.message : String(secondErr);
            throw new Error(`Patch application failed after retry: ${m2}`);
          }
        } else if (typeof retryParsed.improved_prompt === 'string' && retryParsed.improved_prompt.trim().length > 0) {
          proposedPrompt = retryParsed.improved_prompt as string;
          patches = [];
        } else {
          throw new Error(`Patch application failed: ${message}`);
        }
      } else {
        throw new Error(`Patch application failed: ${message}`);
      }
    }

    console.log('[improve] Step 3: Validating improvement...');
    const validatorPrompt = `You are a strict QA validator for AI agent prompts.

ORIGINAL PROBLEM: "${feedback}"
PROPOSED IMPROVEMENT SUMMARY: "${String(generated.changes_summary ?? '')}"

PROPOSED PROMPT AFTER PATCHES:
${proposedPrompt}

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
      const validatorValidate = (obj: unknown) => {
        if (!obj || typeof obj !== 'object') return false;
        const o = obj as Record<string, unknown>;
        if (typeof o.is_valid !== 'boolean') return false;
        if (typeof o.confidence !== 'number') return false;
        if (typeof o.validation_note !== 'string') return false;
        return true;
      };

      const validatorResult = await callOpenAIForImproveWithRetry(
        validatorSystemInstruction,
        validatorPrompt,
        0.1,
        buildValidatorSchema(),
        {
          admin,
          agentId: params.agentId,
          feedback,
          phase: 'validator',
        },
        validatorValidate,
        3
      );

      const validation = validatorResult.parsedJson;
      isValid = validation.is_valid !== false;
      console.log('[improve] Validation:', validation.confidence, validation.validation_note);
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError);
      console.warn('[improve] Validation step failed, proceeding anyway:', message);
      // Log a failed parse for diagnostics if logFailedJsonParse exists
      try {
        // Importing logFailedJsonParse dynamically to avoid unused import errors earlier
        const { logFailedJsonParse: _logFailed } = await import('@/lib/server/ai/improve-agent');
        await _logFailed(admin, {
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
      } catch {
        // ignore logging failure
      }
    }

    return NextResponse.json({
      improved_prompt: proposedPrompt,
      patches,
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
