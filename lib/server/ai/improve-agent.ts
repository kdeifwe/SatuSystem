import type { SupabaseClient } from '@supabase/supabase-js';
import { buildGeminiObjectSchema } from '@/lib/server/ai/gemini-response-schema';
import { llmClient } from '@/lib/server/ai/llm-client';

type ImprovePhase = 'critic' | 'generator' | 'validator';

export type PromptPatch = {
  search: string;
  replace: string;
  reason: string;
};

type GeminiResponse = {
  text: string;
  metadata: Record<string, unknown>;
  rawResponse?: unknown;
  parsedJson?: Record<string, unknown> | null;
};

type ImproveLogContext = {
  agentId: string;
  feedback: string;
  phase: ImprovePhase;
  prompt: string;
  model: string;
  latencyMs: number;
  tokensInput?: number | null;
  tokensOutput?: number | null;
  rawText?: string | null;
  rawResponse?: unknown;
  error?: string | null;
  parseError?: string | null;
  responseSchema?: boolean;
  provider?: string | null;
  attempt?: number | null;
};

export function buildCriticSchema() {
  return buildGeminiObjectSchema(
    {
      root_cause: { type: 'string' },
      weak_sections: { type: 'array', items: { type: 'string' } },
      specific_fixes_needed: { type: 'array', items: { type: 'string' } },
      severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
    },
    ['root_cause', 'weak_sections', 'specific_fixes_needed', 'severity']
  );
}

export function buildGeneratorSchema() {
  return buildGeminiObjectSchema(
    {
      patches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            search: { type: 'string' },
            replace: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['search', 'replace', 'reason'],
        },
      },
      changes_summary: { type: 'string' },
      key_improvements: { type: 'array', items: { type: 'string' } },
    },
    ['patches', 'changes_summary', 'key_improvements']
  );
}

export function buildValidatorSchema() {
  return buildGeminiObjectSchema(
    {
      is_valid: { type: 'boolean' },
      confidence: { type: 'number' },
      validation_note: { type: 'string' },
    },
    ['is_valid', 'confidence', 'validation_note']
  );
}

function countOccurrences(text: string, search: string): number {
  if (!search) {
    return 0;
  }

  let count = 0;
  let index = 0;
  while (index <= text.length) {
    const nextIndex = text.indexOf(search, index);
    if (nextIndex === -1) {
      break;
    }
    count += 1;
    index = nextIndex + search.length;
  }

  return count;
}

export function applyPromptPatches(currentPrompt: string, patches: PromptPatch[]): string {
  if (typeof currentPrompt !== 'string') {
    throw new Error('Current prompt must be a string');
  }

  if (!Array.isArray(patches)) {
    throw new Error('Patch list must be an array');
  }

  let workingPrompt = currentPrompt;

  patches.forEach((patch, index) => {
    if (!patch || typeof patch !== 'object') {
      throw new Error(`Patch #${index + 1} failed: patch entry is not an object`);
    }

    const search = typeof patch.search === 'string' ? patch.search : '';
    const replace = typeof patch.replace === 'string' ? patch.replace : '';

    if (!search.trim()) {
      throw new Error(`Patch #${index + 1} failed: search fragment must not be empty`);
    }

    const count = countOccurrences(workingPrompt, search);
    if (count !== 1) {
      throw new Error(`Patch #${index + 1} failed: search fragment must appear exactly once in current prompt (found ${count})`);
    }

    workingPrompt = workingPrompt.replace(search, replace);
  });

  return workingPrompt;
}

function sanitizeJsonText(rawText: string): string {
  return rawText
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```/g, '')
    .trim();
}

function extractJsonCandidate(rawText: string): string {
  const cleaned = sanitizeJsonText(rawText);

  let inString = false;
  let escaped = false;

  for (let index = 0; index < cleaned.length; index += 1) {
    const char = cleaned[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char !== '{') {
      continue;
    }

    let depth = 0;
    let candidateInString = false;
    let candidateEscaped = false;

    for (let cursor = index; cursor < cleaned.length; cursor += 1) {
      const candidateChar = cleaned[cursor];

      if (candidateEscaped) {
        candidateEscaped = false;
        continue;
      }

      if (candidateChar === '\\') {
        candidateEscaped = true;
        continue;
      }

      if (candidateChar === '"') {
        candidateInString = !candidateInString;
        continue;
      }

      if (candidateInString) {
        continue;
      }

      if (candidateChar === '{') {
        depth += 1;
      } else if (candidateChar === '}') {
        depth -= 1;
        if (depth === 0) {
          const candidate = cleaned.slice(index, cursor + 1).trim();
          try {
            JSON.parse(candidate);
            return candidate;
          } catch {
            break;
          }
        }
      }
    }
  }

  throw new Error('JSON object not found in model response');
}

export function repairJsonText(candidate: string): string {
  let repaired = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < candidate.length; index += 1) {
    const char = candidate[index];

    if (escaped) {
      repaired += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      repaired += '\\';
      escaped = true;
      continue;
    }

    if (char === '"') {
      repaired += '"';
      inString = !inString;
      continue;
    }

    if (inString) {
      if (char === '\n') {
        repaired += '\\n';
      } else if (char === '\r') {
        repaired += '\\r';
      } else if (char === '\t') {
        repaired += '\\t';
      } else {
        repaired += char;
      }
      continue;
    }

    repaired += char;
  }

  return repaired;
}

export function getGeminiCandidateText(candidate: any): { text: string; parsedJson: Record<string, unknown> | null } {
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const textParts: string[] = [];
  let parsedJson: Record<string, unknown> | null = null;

  for (const part of parts) {
    if (!part || typeof part !== 'object') {
      continue;
    }

    if (parsedJson === null && part.json !== undefined && part.json !== null) {
      if (typeof part.json === 'object' && !Array.isArray(part.json)) {
        parsedJson = part.json as Record<string, unknown>;
      } else if (typeof part.json === 'string') {
        try {
          const parsed = JSON.parse(part.json);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            parsedJson = parsed as Record<string, unknown>;
          }
        } catch {
          // Ignore invalid JSON in part.json and continue with text fallback.
        }
      }
    }

    if (typeof part.text === 'string' && part.text.trim().length > 0) {
      textParts.push(part.text.trim());
    }
  }

  const text = parsedJson !== null ? JSON.stringify(parsedJson) : textParts.join('\n').trim();
  return { text, parsedJson };
}

export function extractJsonPayload(rawText: string): Record<string, unknown> {
  try {
    const candidate = extractJsonCandidate(rawText);
    const repairedCandidate = repairJsonText(candidate);
    const parsed = JSON.parse(repairedCandidate);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Parsed JSON is not an object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON: ${detail}`);
  }
}

/**
 * Log improve-agent Gemini call with FULL raw_response including usageMetadata
 * CRITICAL: This logging includes complete usageMetadata (thoughtsTokenCount, promptTokenCount,
 * candidatesTokenCount, totalTokenCount) for diagnostics. Never truncate usageMetadata.
 * Historical note: This was essential for diagnosing the original MAX_TOKENS issue.
 */
async function logImproveCall(
  admin: SupabaseClient | null,
  context: ImproveLogContext
) {
  if (!admin) return;
  try {
    const responsePreview = typeof context.rawText === 'string' && context.rawText.length > 0
      ? `${context.rawText.slice(0, 120)}${context.rawText.length > 120 ? '…' : ''}`
      : null;
    const responseTail = typeof context.rawText === 'string' && context.rawText.length > 120
      ? context.rawText.slice(-80)
      : null;

    const finishReason =
      context.rawResponse && typeof context.rawResponse === 'object'
        ? (context.rawResponse as any)?.candidates?.[0]?.finishReason ?? null
        : null;

    // CRITICAL: Extract full usageMetadata from rawResponse (Gemini API response)
    // This must include: promptTokenCount, candidatesTokenCount, totalTokenCount, thoughtsTokenCount
    const fullUsageMetadata = context.rawResponse && typeof context.rawResponse === 'object'
      ? (context.rawResponse as any)?.usageMetadata ?? null
      : null;

    const usageMetadata = fullUsageMetadata
      ? {
          // Spread all fields from Gemini response
          ...fullUsageMetadata,
          // Explicit defaults for safety
          promptTokenCount: fullUsageMetadata?.promptTokenCount ?? 0,
          candidatesTokenCount: fullUsageMetadata?.candidatesTokenCount ?? 0,
          totalTokenCount: fullUsageMetadata?.totalTokenCount ?? 0,
          thoughtsTokenCount: fullUsageMetadata?.thoughtsTokenCount ?? 0,
        }
      : null;

    await admin.from('ai_call_logs').insert({
      conversation_id: null,
      request: {
        type: 'improve_agent',
        phase: context.phase,
        provider: context.provider ?? 'openai',
        agent_id: context.agentId,
        feedback: context.feedback,
        prompt: context.prompt,
        model: context.model,
        response_schema: context.responseSchema ?? false,
        attempt: context.attempt ?? null,
      },
      response: {
        provider: context.provider ?? 'openai',
        // Store FULL raw_response from OpenAI or Gemini (includes usage tokens, function call data, etc)
        raw: context.rawResponse ?? null,
        raw_response: context.rawResponse ?? null,
        response_preview: responsePreview,
        response_tail: responseTail,
        response_length: context.rawText?.length ?? 0,
        finish_reason: finishReason,
        error: context.error ?? null,
        parse_error: context.parseError ?? null,
        // CRITICAL: Store full usageMetadata (not truncated)
        usage_metadata: usageMetadata,
        metadata: {
          response_length: context.rawText?.length ?? 0,
          finish_reason: finishReason,
          // CRITICAL: Duplicate usageMetadata here for redundancy/safety
          usage_metadata: usageMetadata,
        },
        attempt: context.attempt ?? null,
      },
      tokens_input: context.tokensInput ?? null,
      tokens_output: context.tokensOutput ?? null,
      latency_ms: context.latencyMs ?? null,
    });
  } catch (logError) {
    console.warn('[improve] failed to write ai_call_logs', logError);
  }
}

export async function callOpenAIForImprove(
  systemInstruction: string,
  prompt: string,
  temperature: number,
  responseSchema: Record<string, unknown> | null,
  options: {
    admin?: SupabaseClient | null;
    agentId?: string;
    feedback?: string;
    phase: ImprovePhase;
    attempt?: number | null;
  }
): Promise<GeminiResponse> {
  const startedAt = Date.now();
  let fullRawResponse: any = null;

  try {
    const llmResponse = await llmClient.generate({
      model: 'gpt-5.4',
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt },
      ],
      temperature,
      maxTokens: 32768,
      jsonSchema: responseSchema ?? undefined,
    });

    fullRawResponse = llmResponse.rawResponse ?? llmResponse;
    const text = llmResponse.text ?? '';
    const latencyMs = Date.now() - startedAt;
    const tokensInput = llmResponse.usage?.promptTokens ?? 0;
    const tokensOutput = llmResponse.usage?.completionTokens ?? 0;
    const model = 'gpt-5.4';
    const provider = llmResponse.provider ?? 'openai';

    const logContext: ImproveLogContext = {
      agentId: options.agentId ?? 'unknown',
      feedback: options.feedback ?? '',
      phase: options.phase,
      prompt,
      model,
      provider,
      latencyMs,
      tokensInput,
      tokensOutput,
      attempt: options.attempt ?? null,
      rawText: text,
      rawResponse: fullRawResponse,
      responseSchema: Boolean(responseSchema),
    };

    if (text.trim().length > 0) {
      await logImproveCall(options.admin ?? null, logContext);
      return {
        text,
        metadata: {
          model,
          finishReason: llmResponse.finishReason,
          promptTokenCount: tokensInput,
          candidatesTokenCount: tokensOutput,
        },
        rawResponse: fullRawResponse,
        parsedJson: null,
      };
    }

    logContext.error = 'OpenAI returned empty text';
    await logImproveCall(options.admin ?? null, logContext);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[improve] OpenAI error:', message);
    await logImproveCall(options.admin ?? null, {
      agentId: options.agentId ?? 'unknown',
      feedback: options.feedback ?? '',
      phase: options.phase,
      prompt,
      model: 'gpt-5.4',
      provider: 'openai',
      latencyMs: Date.now() - startedAt,
      rawText: '',
      rawResponse: fullRawResponse,
      error: message,
      responseSchema: Boolean(responseSchema),
      attempt: options.attempt ?? null,
    });
  }

  throw new Error('OpenAI did not return a valid response');
}

export async function callOpenAIForImproveWithRetry(
  systemInstruction: string,
  prompt: string,
  temperature: number,
  responseSchema: Record<string, unknown> | null,
  options: {
    admin?: SupabaseClient | null;
    agentId?: string;
    feedback?: string;
    phase: ImprovePhase;
  },
  validateFn: (obj: unknown) => boolean,
  maxAttempts = 3
): Promise<{ parsedJson: Record<string, unknown>; geminiResponse: GeminiResponse; attempt: number }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await callOpenAIForImprove(systemInstruction, prompt, temperature, responseSchema, {
        admin: options.admin ?? null,
        agentId: options.agentId,
        feedback: options.feedback,
        phase: options.phase,
        attempt,
      });

      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = (res.parsedJson ?? extractJsonPayload(res.text)) as Record<string, unknown>;
      } catch (parseError) {
        const message = parseError instanceof Error ? parseError.message : String(parseError);
        await logFailedJsonParse(options.admin ?? null, {
          agentId: options.agentId ?? 'unknown',
          feedback: options.feedback ?? '',
          phase: options.phase,
          prompt,
          model: 'gpt-5.4',
          latencyMs: 0,
          rawText: res.text,
          rawResponse: res.rawResponse ?? null,
          parseError: message,
          attempt,
        });

        if (attempt < maxAttempts) continue;
        throw parseError;
      }

      // structural validation
      try {
        const ok = validateFn(parsed);
        if (!ok) {
          const message = 'Schema validation failed';
          await logFailedJsonParse(options.admin ?? null, {
            agentId: options.agentId ?? 'unknown',
            feedback: options.feedback ?? '',
            phase: options.phase,
            prompt,
            model: 'gpt-5.4',
            latencyMs: 0,
            rawText: res.text,
            rawResponse: res.rawResponse ?? null,
            parseError: message,
            attempt,
          });

          if (attempt < maxAttempts) continue;
          throw new Error(message);
        }
      } catch (e) {
        if (attempt < maxAttempts) continue;
        throw e;
      }

      return { parsedJson: parsed as Record<string, unknown>, geminiResponse: res, attempt };
    } catch (err) {
      // If last attempt, rethrow
      if (attempt >= maxAttempts) throw err;
      // otherwise continue to retry
    }
  }

  throw new Error('All OpenAI attempts failed');
}

export async function logFailedJsonParse(
  admin: SupabaseClient | null,
  context: ImproveLogContext & { rawText: string }
) {
  await logImproveCall(admin, {
    ...context,
    error: 'JSON parse failed',
    parseError: context.parseError ?? 'Failed to parse JSON',
  });
}
