import { GeminiProvider } from './providers/gemini-provider';
import { DeepSeekProvider } from './providers/deepseek-provider';
import { OpenAIProvider } from './providers/openai-provider';
import { GroqProvider } from './providers/groq-provider';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: any[];
}

export interface LLMResponse {
  text: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  provider: string;
}

export interface LLMProvider {
  name: string;
  generate(request: LLMRequest): Promise<LLMResponse>;
  isAvailable(): boolean;
}

export class UnifiedLLMClient {
  private providers: Map<string, LLMProvider>;
  private fallbackChain: string[];

  constructor() {
    this.providers = new Map();
    this.fallbackChain = [
      process.env.PRIMARY_LLM_PROVIDER ?? 'gemini',
      process.env.FALLBACK_LLM_PROVIDER ?? 'openai',
      'groq',
    ].filter(Boolean);

    if (process.env.GEMINI_API_KEY) {
      this.providers.set('gemini', new GeminiProvider());
    }

    if (process.env.DEEPSEEK_API_KEY) {
      this.providers.set('deepseek', new DeepSeekProvider());
    }

    if (process.env.OPENAI_API_KEY) {
      this.providers.set('openai', new OpenAIProvider());
    }

    if (process.env.GROQ_API_KEY) {
      this.providers.set('groq', new GroqProvider());
    }
  }

  private resolveProviderModel(providerName: string, requestedModel: string): string {
    const normalized = requestedModel.trim().toLowerCase();
    const isGemini = normalized.startsWith('gemini-');
    const isDeepSeek = normalized.startsWith('deepseek-');
    const isOpenAI = normalized.startsWith('gpt-') || normalized.startsWith('gpt4');
    const isGroqModel = normalized.startsWith('llama-') || normalized.startsWith('mixtral-');

    if (providerName === 'gemini' && isGemini) return requestedModel;
    if (providerName === 'deepseek' && isDeepSeek) return requestedModel;
    if (providerName === 'openai' && isOpenAI) return requestedModel;
    if (providerName === 'groq' && (isGroqModel || isOpenAI)) return requestedModel;

    if (providerName === 'gemini') return process.env.GEMINI_CHAT_MODEL ?? 'gemini-2.5-flash';
    if (providerName === 'deepseek') return process.env.PRIMARY_LLM_MODEL ?? 'deepseek-v4-flash';
    if (providerName === 'openai') return process.env.FALLBACK_LLM_MODEL ?? 'gpt-5.4-mini';
    if (providerName === 'groq') return 'llama-3.3-70b-versatile';

    return requestedModel;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const errors: string[] = [];

    const model = (request.model || '').toLowerCase();
    let targetProvider: string;

    if (model.startsWith('gemini-')) {
      targetProvider = 'gemini';
    } else if (model.startsWith('deepseek-')) {
      targetProvider = 'deepseek';
    } else if (model.startsWith('gpt-') || model.startsWith('gpt4')) {
      if (this.providers.has('openai')) {
        targetProvider = 'openai';
      } else if (this.providers.has('groq')) {
        targetProvider = 'groq';
      } else {
        targetProvider = process.env.PRIMARY_LLM_PROVIDER ?? 'openai';
      }
    } else if (model.startsWith('llama-')) {
      targetProvider = 'groq';
    } else {
      targetProvider = process.env.PRIMARY_LLM_PROVIDER ?? 'gemini';
    }

    const chain = [
      targetProvider,
      ...this.fallbackChain.filter((p) => p !== targetProvider),
    ].filter((v, i, a) => a.indexOf(v) === i);

    for (const providerName of chain) {
      const provider = this.providers.get(providerName);
      if (!provider || !provider.isAvailable()) continue;

      const providerModel = this.resolveProviderModel(providerName, request.model);
      try {
        const response = await provider.generate({ ...request, model: providerModel });
        const usageInfo = response.usage;
        console.info(`[LLM] provider=${providerName} model=${providerModel} tokens=${usageInfo ? `${usageInfo.promptTokens}/${usageInfo.completionTokens}/${usageInfo.totalTokens}` : 'unknown'}`);
        return response;
      } catch (err: any) {
        const msg = err?.message || String(err);
        console.warn(`[LLM] ${providerName} failed:`, msg);
        errors.push(`${providerName}: ${msg}`);

        if (err?.status === 403 || err?.status === 401 || msg.toLowerCase().includes('denied') || msg.toLowerCase().includes('unauthorized')) {
          continue;
        }
      }
    }

    throw new Error(`Все LLM-провайдеры недоступны: ${errors.join('; ')}`);
  }
}

export const llmClient = new UnifiedLLMClient();
