export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_CHAT_MODEL = process.env.GEMINI_CHAT_MODEL ?? 'gemini-3.5-flash';
export const GEMINI_PROMPT_MODEL = process.env.GEMINI_PROMPT_MODEL ?? 'gemini-2.5-flash';
export const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-2';
export const GEMINI_EMBEDDING_OUTPUT_DIMENSIONALITY = Number(process.env.GEMINI_EMBEDDING_OUTPUT_DIM ?? '768');

const DEFAULT_RETRY_ATTEMPTS = 2;
const BASE_RETRY_DELAY_MS = 2000;

function getGeminiApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY не задан');
  }
  return apiKey;
}

function hasFeature(model: any, feature: string): boolean {
  if (!model) return false;
  const values = [] as string[];

  if (Array.isArray(model.supportedMethods)) {
    values.push(...model.supportedMethods.map(String));
  }
  if (Array.isArray(model.supported_methods)) {
    values.push(...model.supported_methods.map(String));
  }
  if (Array.isArray(model.supportedOperators)) {
    values.push(...model.supportedOperators.map(String));
  }
  if (Array.isArray(model.supported_operators)) {
    values.push(...model.supported_operators.map(String));
  }
  if (Array.isArray(model.capabilities)) {
    values.push(...model.capabilities.map(String));
  }
  if (typeof model.name === 'string') {
    values.push(model.name);
  }
  const text = JSON.stringify(model).toLowerCase();
  values.push(text);

  return values.some((item) => item.toLowerCase().includes(feature.toLowerCase()));
}

export async function geminiFetch(
  model: string,
  endpoint: 'generateContent' | 'embedContent',
  body: object,
): Promise<Response> {
  const apiKey = getGeminiApiKey();
  const url = `${GEMINI_API_BASE}/models/${model}:${endpoint}?key=${apiKey}`;

  for (let attempt = 0; attempt < DEFAULT_RETRY_ATTEMPTS; attempt += 1) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      return res;
    }

    if (res.status === 404) {
      const errorText = await res.text();
      console.error(`[gemini-client] CRITICAL model not found: ${model} ${endpoint} - ${res.status} ${errorText}`);
      throw new Error(`Gemini model not found: ${model}`);
    }

    if (res.status === 429 || res.status === 503) {
      const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
      console.warn(`[gemini-client] ${model} attempt ${attempt + 1} failed with ${res.status}, retrying in ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    return res;
  }

  throw new Error(`Все модели Gemini недоступны по адресу: ${model}:${endpoint}. Попробуй через несколько минут.`);
}

export async function listGeminiModels(): Promise<any[]> {
  const apiKey = getGeminiApiKey();
  const res = await fetch(`${GEMINI_API_BASE}/models?key=${apiKey}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini list models error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.models ?? [];
}

export function isModelSupporting(model: any, feature: 'generateContent' | 'embedContent'): boolean {
  return hasFeature(model, feature);
}
