import type { SupabaseClient } from '@supabase/supabase-js';
import { buildGeminiObjectSchema } from '@/lib/server/ai/gemini-response-schema';

type ImprovePhase = 'critic' | 'generator' | 'validator';

type GeminiResponse = {
  text: string;
  metadata: Record<string, unknown>;
  rawResponse?: unknown;
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
      improved_prompt: { type: 'string' },
      changes_summary: { type: 'string' },
      key_improvements: { type: 'array', items: { type: 'string' } },
    },
    ['improved_prompt', 'changes_summary', 'key_improvements']
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

function sanitizeJsonText(rawText: string): string {
  return rawText
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```/g, '')
    .trim();
}

function extractJsonCandidate(rawText: string): string {
  const cleaned = sanitizeJsonText(rawText);
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('JSON object not found in model response');
  }

  return cleaned.slice(firstBrace, lastBrace + 1).trim();
}

export function extractJsonPayload(rawText: string): Record<string, unknown> {
  try {
    const candidate = extractJsonCandidate(rawText);
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Parsed JSON is not an object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON: ${detail}`);
  }
}

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

    await admin.from('ai_call_logs').insert({
      conversation_id: null,
      request: {
        type: 'improve_agent',
        phase: context.phase,
        agent_id: context.agentId,
        feedback: context.feedback,
        prompt: context.prompt,
        model: context.model,
        response_schema: context.responseSchema ?? false,
      },
      response: {
        response_preview: responsePreview,
        response_tail: responseTail,
        response_length: context.rawText?.length ?? 0,
        finish_reason: finishReason,
        error: context.error ?? null,
        parse_error: context.parseError ?? null,
        metadata: {
          response_length: context.rawText?.length ?? 0,
          finish_reason: finishReason,
        },
      },
      tokens_input: context.tokensInput ?? null,
      tokens_output: context.tokensOutput ?? null,
      latency_ms: context.latencyMs ?? null,
    });
  } catch (logError) {
    console.warn('[improve] failed to write ai_call_logs', logError);
  }
}

export async function callGeminiForImprove(
  apiKey: string,
  systemInstruction: string,
  prompt: string,
  temperature: number,
  responseSchema: Record<string, unknown> | null,
  options: {
    admin?: SupabaseClient | null;
    agentId?: string;
    feedback?: string;
    phase: ImprovePhase;
  }
): Promise<GeminiResponse> {
  const models = ['gemini-2.5-flash', 'gemini-2.5-pro'];
  const requestBody = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      topP: 0.2,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      ...(responseSchema ? { responseSchema } : {}),
    },
  };

  for (const model of models) {
    const startedAt = Date.now();
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }
      );

      const rawText = await res.text();
      let data: any = null;
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        data = null;
      }

      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const latencyMs = Date.now() - startedAt;
      const tokensInput = data?.usageMetadata?.promptTokenCount ?? 0;
      const tokensOutput = data?.usageMetadata?.candidatesTokenCount ?? 0;

      const logContext: ImproveLogContext = {
        agentId: options.agentId ?? 'unknown',
        feedback: options.feedback ?? '',
        phase: options.phase,
        prompt,
        model,
        latencyMs,
        tokensInput,
        tokensOutput,
        rawText: text,
        rawResponse: data,
        responseSchema: Boolean(responseSchema),
      };

      if (!res.ok) {
        const errorText = rawText.slice(0, 1000);
        logContext.error = `Gemini returned ${res.status}: ${errorText}`;
        await logImproveCall(options.admin ?? null, logContext);
        console.error(`[improve] ${model} returned ${res.status}:`, errorText);
        continue;
      }

      if (text.trim().length > 0) {
        await logImproveCall(options.admin ?? null, logContext);
        return {
          text,
          metadata: {
            model,
            finishReason: data?.candidates?.[0]?.finishReason,
            promptTokenCount: tokensInput,
            candidatesTokenCount: tokensOutput,
          },
          rawResponse: data,
        };
      }

      logContext.error = 'Gemini returned empty text';
      await logImproveCall(options.admin ?? null, logContext);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[improve] ${model} error:`, message);
      await logImproveCall(options.admin ?? null, {
        agentId: options.agentId ?? 'unknown',
        feedback: options.feedback ?? '',
        phase: options.phase,
        prompt,
        model,
        latencyMs: Date.now() - startedAt,
        rawText: '',
        rawResponse: null,
        error: message,
        responseSchema: Boolean(responseSchema),
      });
    }
  }

  throw new Error('Все модели Gemini недоступны');
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
