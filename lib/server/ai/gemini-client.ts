export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_CHAT_MODEL = process.env.GEMINI_CHAT_MODEL ?? 'gemini-2.5-flash';
export const GEMINI_PROMPT_MODEL = process.env.GEMINI_PROMPT_MODEL ?? 'gemini-2.5-flash';
export const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-2';
export const GEMINI_EMBEDDING_OUTPUT_DIMENSIONALITY = Number(process.env.GEMINI_EMBEDDING_OUTPUT_DIM ?? '768');

export function extractGeminiUsageMetadata(body: any): { tokensInput: number; tokensOutput: number } {
  const usage = body?.usageMetadata ?? {};
  return {
    tokensInput: Number(usage.promptTokenCount ?? 0),
    tokensOutput: Number(usage.candidatesTokenCount ?? 0),
  };
}

const DEFAULT_RETRY_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 1000;

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

import dns from 'dns';
import { resolve6 } from 'dns/promises';

export async function geminiFetch(
  model: string,
  endpoint: 'generateContent' | 'embedContent',
  body: object,
): Promise<Response> {
  const apiKey = getGeminiApiKey();
  const url = `${GEMINI_API_BASE}/models/${model}:${endpoint}?key=${apiKey}`;

  // If operator requests forcing IPv4 resolution (diagnostic), prefer IPv4.
  if (process.env.FORCE_IPV4 === '1') {
    try {
      // available in Node 18+
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (typeof dns.setDefaultResultOrder === 'function') {
        // prefer IPv4 first
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        dns.setDefaultResultOrder('ipv4first');
        console.info('[gemini-client] setDefaultResultOrder: ipv4first (FORCE_IPV4=1)');
      }
    } catch (e) {
      console.warn('[gemini-client] failed to set IPv4-first resolution', e);
    }
  }

  // Log whether the host resolves to IPv6 addresses (for diagnostics).
  (async () => {
    try {
      const host = new URL(GEMINI_API_BASE).hostname;
      const aaaa = await resolve6(host).catch(() => []);
      if (Array.isArray(aaaa) && aaaa.length > 0) {
        console.info('[gemini-client] host has AAAA records', { host, aaaa });
      } else {
        console.info('[gemini-client] host has no AAAA records', { host });
      }
    } catch (e) {
      // don't fail on diagnostics
    }
  })();

  for (let attempt = 0; attempt < DEFAULT_RETRY_ATTEMPTS; attempt += 1) {
    try {
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
    } catch (err: any) {
      // network/connection errors (eg. undici connect timeout) may throw.
      const isTimeout = err && (err.code === 'UND_ERR_CONNECT_TIMEOUT' || err.type === 'request-timeout' || err.code === 'ETIMEDOUT');
      console.warn('[gemini-client] fetch error', { attempt: attempt + 1, code: err?.code, message: err?.message });

      if (attempt < DEFAULT_RETRY_ATTEMPTS - 1) {
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
        // On timeout-like errors, wait and retry. If FORCE_IPV4 set, we've already
        // set DNS order ipv4first; otherwise, retrying may help transient routing.
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // Last attempt failed — surface the original error.
      throw err;
    }
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

export async function geminiCountTokens(model: string, contents: Array<Record<string, unknown>>): Promise<number> {
  const payload = contents.map((content) => JSON.stringify(content)).join('\n');
  return Math.max(1, Math.ceil(payload.length / 4));
}

export function isModelSupporting(model: any, feature: 'generateContent' | 'embedContent'): boolean {
  return hasFeature(model, feature);
}
