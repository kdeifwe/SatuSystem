import { llmClient } from '@/lib/server/ai/llm-client';
import { GEMINI_CHAT_MODEL } from '@/lib/server/ai/gemini-client';
import { buildGeminiObjectSchema } from '@/lib/server/ai/gemini-response-schema';
import type { FunnelFlow } from './types';

const FLOW_SCHEMA = buildGeminiObjectSchema({
  nodes: {
    type: 'array',
    items: buildGeminiObjectSchema({
      id: { type: 'string' },
      title: { type: 'string' },
      content: { type: 'string' },
      position: buildGeminiObjectSchema({
        x: { type: 'number' },
        y: { type: 'number' },
      }, ['x', 'y']),
    }, ['id', 'title', 'content']),
  },
  edges: {
    type: 'array',
    items: buildGeminiObjectSchema({
      id: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      label: { type: 'string' },
    }, ['id', 'from', 'to', 'label']),
  },
  entryNodeId: { type: 'string' },
}, ['nodes', 'edges', 'entryNodeId']);

const SYSTEM_PROMPT = `Ты — конструктор воронок продаж. Пользователь на естественном языке описывает свой процесс продаж и твоя задача — превратить это описание в структурированный граф шагов.

Правила:
- Каждый узел (node) — это один логический шаг диалога с конкретной инструкцией для AI-агента.
- content каждого узла должен быть прямой инструкцией агенту, не описанием для человека.
- edges — это переходы между шагами с условием (label), например "готов купить", "сомневается", "отказ".
- Строй граф СТРОГО по тому, что описал пользователь. Не добавляй шаги, узлы или ветки, которые пользователь не упоминал — даже если тебе кажется, что они полезны.
- Если пользователь явно описал только линейную последовательность без развилок — сделай линейный граф без веток.
- Если считаешь, что стоит добавить обработку возражений или другую ветку — НЕ добавляй её сам, а спроси пользователя в своём текстовом ответе: "Хотите, чтобы я добавил ветку для случая, если клиент откажется или засомневается?"
- Если описание длинное и многошаговое, разбивай его на отдельные узлы графа вместо того, чтобы сжимать всё в один узел.
- Если пользователь просит изменить существующий граф, возвращай Полный обновлённый граф целиком, сохраняя id уже существующих узлов, чтобы позиции не сбрасывались.

Отвечай только валидным JSON по схеме, без markdown и без пояснений.`;

function extractText(response: Record<string, unknown>): string {
  const candidates = Array.isArray((response as any)?.candidates) ? (response as any).candidates : [];
  const parts = Array.isArray(candidates[0]?.content?.parts) ? candidates[0].content.parts : [];
  return parts
    .filter((part: Record<string, unknown>) => typeof part?.text === 'string')
    .map((part: Record<string, unknown>) => part.text)
    .join('\n')
    .trim();
}

function defaultPosition(index: number) {
  const column = index % 3;
  const row = Math.floor(index / 3);
  return { x: column * 320, y: row * 220 };
}

function normalizeParsedFlow(parsed: Partial<FunnelFlow>): FunnelFlow {
  return {
    nodes: Array.isArray(parsed.nodes) ? (parsed.nodes as FunnelFlow['nodes']) : [],
    edges: Array.isArray(parsed.edges) ? (parsed.edges as FunnelFlow['edges']) : [],
    entryNodeId: typeof parsed.entryNodeId === 'string' ? parsed.entryNodeId : '',
  };
}

function tryRecoverPartialJson(cleaned: string): string | null {
  for (let closeBraces = 0; closeBraces <= 6; closeBraces += 1) {
    for (let closeBrackets = 0; closeBrackets <= 6; closeBrackets += 1) {
      const candidate = cleaned + '}'.repeat(closeBraces) + ']'.repeat(closeBrackets);
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        // пробуем добавить недостающие закрывающие скобки
      }
    }
  }

  return null;
}

export function parseGeminiFlowResponse(rawText: string): FunnelFlow {
  let cleaned = rawText.trim();

  if (cleaned.startsWith('```')) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  }

  try {
    return normalizeParsedFlow(JSON.parse(cleaned) as Partial<FunnelFlow>);
  } catch (err) {
    const recovered = tryRecoverPartialJson(cleaned);
    if (recovered) {
      try {
        return normalizeParsedFlow(JSON.parse(recovered) as Partial<FunnelFlow>);
      } catch {
        // не удалось восстановить структуру
      }
    }

    console.error('[funnel-builder] Не удалось распарсить ответ Gemini:', {
      error: err,
      rawTextLength: rawText.length,
      rawTextPreview: rawText.slice(0, 500),
    });

    throw new Error(
      'AI не смог сформировать полную схему воронки — попробуйте описать сценарий короче ' +
        'или разбить его на несколько сообщений (например, сначала опишите приветствие и ' +
        'первые вопросы, затем отдельным сообщением — остальное).',
    );
  }
}

function autoLayoutIfMissing(flow: FunnelFlow, existingFlow: FunnelFlow | null): FunnelFlow {
  const positionsById = new Map((existingFlow?.nodes ?? []).map((node) => [node.id, node.position]));

  const nodes = (flow.nodes ?? []).map((node, index) => {
    const existingPosition = positionsById.get(node.id);
    return {
      ...node,
      position: existingPosition ?? node.position ?? defaultPosition(index),
    };
  });

  return {
    nodes,
    edges: flow.edges ?? [],
    entryNodeId: flow.entryNodeId ?? nodes[0]?.id ?? existingFlow?.entryNodeId ?? '',
  };
}

export async function buildOrUpdateFlow(
  userMessage: string,
  conversationHistory: Array<{ role: 'user' | 'model'; text: string }>,
  existingFlow: FunnelFlow | null,
): Promise<FunnelFlow> {
  const contextPrompt = existingFlow
    ? `Текущий граф (пользователь просит его изменить):\n${JSON.stringify(existingFlow)}`
    : 'Графа пока нет, строим с нуля.';

  const prompt = `${SYSTEM_PROMPT}\n\n${contextPrompt}\n\nИстория диалога:\n${conversationHistory.map((entry) => `${entry.role === 'user' ? 'Пользователь' : 'AI'}: ${entry.text}`).join('\n')}\n\nЗапрос пользователя:\n${userMessage}`;

  const llmResponse = await llmClient.generate({
    model: GEMINI_CHAT_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
    maxTokens: 8192,
  });

  const data = {
    candidates: [
      {
        content: {
          parts: [{ text: llmResponse.text }],
        },
      },
    ],
  };
  const raw = extractText(data);
  if (!raw) {
    throw new Error('Gemini не вернул структурированный граф');
  }

  return autoLayoutIfMissing(parseGeminiFlowResponse(raw), existingFlow);
}
