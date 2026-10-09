import { NextResponse } from 'next/server';
import {
  GEMINI_CHAT_MODEL,
  GEMINI_PROMPT_MODEL,
  GEMINI_EMBEDDING_MODEL,
  listGeminiModels,
  isModelSupporting,
  normalizeGeminiModelName,
} from '@/lib/server/ai/gemini-client';

type GeminiOperation = 'generateContent' | 'embedContent';

const requiredModels: { name: string; operation: GeminiOperation }[] = [
  { name: GEMINI_CHAT_MODEL, operation: 'generateContent' },
  { name: GEMINI_PROMPT_MODEL, operation: 'generateContent' },
  { name: GEMINI_EMBEDDING_MODEL, operation: 'embedContent' },
];

export async function GET() {
  try {
    const models = await listGeminiModels();
    const normalizedModels = models.map((model: any) => ({
      ...model,
      normalizedName: normalizeGeminiModelName(model.name),
    }));
    const modelMap = new Map(normalizedModels.map((model: any) => [model.normalizedName, model]));

    const checks = requiredModels.map((required) => {
      const normalizedRequiredName = normalizeGeminiModelName(required.name);
      const model = modelMap.get(normalizedRequiredName);
      return {
        name: normalizedRequiredName,
        expectedOperation: required.operation,
        found: Boolean(model),
        supportsOperation: model ? isModelSupporting(model, required.operation) : false,
        modelInfo: model ?? null,
      };
    });

    const allOk = checks.every((check) => check.found && check.supportsOperation);

    return NextResponse.json({
      success: allOk,
      checks,
      availableModels: normalizedModels.map((model: any) => ({
        name: model.normalizedName,
        supported: model.supportedMethods ?? model.supported_methods ?? [],
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[health/gemini-models] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
