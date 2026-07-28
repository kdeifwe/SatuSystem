export interface FunnelStepPayload {
  id: string;
  title: string;
  triggerDescription: string;
  sampleMessage: string;
  order: number;
}

export interface GenerateFunnelContext {
  scenario: string;
  goal: string;
  targetAudience: string;
  firstQuestion: string;
  commonObjections: string[];
  companyDescription: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'stage';
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

function extractJsonArray(text: string): unknown {
  const codeFenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = codeFenceMatch ? codeFenceMatch[1] : text;
  const jsonStart = candidate.indexOf('[');
  const jsonEnd = candidate.lastIndexOf(']');

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error('No JSON array found');
  }

  return JSON.parse(candidate.slice(jsonStart, jsonEnd + 1));
}

export function buildGenerateFunnelPrompt(context: GenerateFunnelContext): string {
  return `You are a senior conversational designer for a sales/support chatbot.

Business context:
- Scenario: ${context.scenario}
- Goal: ${context.goal || 'help the client effectively'}
- Company description: ${context.companyDescription || 'not provided'}
- Target audience: ${context.targetAudience || 'not provided'}
- First question: ${context.firstQuestion || 'not provided'}
- Common objections: ${context.commonObjections.length > 0 ? context.commonObjections.join(', ') : 'none'}

Design a specific conversation flow for this business. Do NOT return generic stages like contact -> need -> proposal -> close unless that fits this exact business.
Return ONLY a JSON array of 3-6 stages. Each stage must be an object with:
{
  "id": "short-slug",
  "title": "Specific stage title",
  "triggerDescription": "When this stage is activated in the conversation",
  "sampleMessage": "A realistic sample reply for this business",
  "order": 1
}

Make the stages specific to the business and the audience. Prefer concrete, relevant wording. Return raw JSON only.`;
}

export async function generateFunnelFromContext(
  _agentId: string,
  context: GenerateFunnelContext,
): Promise<FunnelStepPayload[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY не задан');

  const models = ['gemini-2.5-flash', 'gemini-2.5-pro'];
  const prompt = buildGenerateFunnelPrompt(context);

  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.6, maxOutputTokens: 1024 },
          }),
        },
      );

      if (!res.ok) continue;

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const parsed = extractJsonArray(text);

      if (!Array.isArray(parsed)) continue;

      return parsed
        .filter((item): item is Record<string, unknown> => item && typeof item === 'object')
        .map((item, index) => ({
          id: toStringValue(item.id) || slugify(toStringValue(item.title) || `stage-${index + 1}`),
          title: toStringValue(item.title) || `Этап ${index + 1}`,
          triggerDescription: toStringValue(item.triggerDescription) || 'Когда клиент готов перейти дальше',
          sampleMessage: toStringValue(item.sampleMessage) || 'Подскажите следующий шаг',
          order: Number(item.order) || index + 1,
        }))
        .filter((item) => item.title)
        .sort((a, b) => a.order - b.order)
        .map((item, index) => ({ ...item, order: index + 1 }));
    } catch (error) {
      console.warn('[generate-funnel] Failed for model', model, error);
    }
  }

  return [];
}