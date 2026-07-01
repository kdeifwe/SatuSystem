import { NextResponse } from 'next/server';
import {
  GEMINI_CHAT_MODEL,
  GEMINI_PROMPT_MODEL,
  GEMINI_EMBEDDING_MODEL,
  listGeminiModels,
  isModelSupporting,
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
    const modelMap = new Map(models.map((model: any) => [model.name, model]));

    const checks = requiredModels.map((required) => {
      const model = modelMap.get(required.name);
      return {
        name: required.name,
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
      availableModels: models.map((model: any) => ({ name: model.name, supported: model.supportedMethods ?? model.supported_methods ?? [] })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[health/gemini-models] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
