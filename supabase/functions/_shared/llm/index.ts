import type { Env } from '../env.ts';
import { LlmError } from '../errors.ts';
import { GeminiProvider } from './gemini.ts';
import { OpenAiCompatibleProvider } from './openai-compatible.ts';
import type { LlmProvider } from './provider.ts';

export type { ImagePart, LlmProvider, LlmProviderName, StructuredRequest, StructuredResult } from './provider.ts';

/**
 * Defaults only — pin the exact model per environment with LLM_MODEL.
 * On OpenRouter pick a model that supports strict structured outputs.
 */
const DEFAULT_MODELS = {
  openai: 'gpt-5-mini',
  openrouter: 'google/gemini-2.5-flash',
  gemini: 'gemini-2.5-flash',
} as const;

const PROJECT_KEY: Record<Env['LLM_PROVIDER'], (env: Env) => string | undefined> = {
  openai: (env) => env.OPENAI_API_KEY,
  openrouter: (env) => env.OPENROUTER_API_KEY,
  gemini: (env) => env.GEMINI_API_KEY,
};

/**
 * `modelOverride` and `apiKeyOverride` are the student's own settings; both
 * fall back to the deployment's. A deployment may legitimately ship without a
 * key of its own — then the student's key is the only one there is, and its
 * absence has to say so in words they can act on.
 */
export function createLlmProvider(env: Env, modelOverride?: string | null, apiKeyOverride?: string | null): LlmProvider {
  const model = modelOverride?.trim() || env.LLM_MODEL || DEFAULT_MODELS[env.LLM_PROVIDER];
  const apiKey = apiKeyOverride?.trim() || PROJECT_KEY[env.LLM_PROVIDER](env) || '';
  if (!apiKey) {
    throw new LlmError('refused', `no api key configured for ${env.LLM_PROVIDER}`, {
      hint: 'Yapay zekâ anahtarı tanımlı değil. Ayarlar → Yapay zekâ modeli bölümünden OpenRouter anahtarını gir.',
    });
  }

  switch (env.LLM_PROVIDER) {
    case 'openai':
      return new OpenAiCompatibleProvider({
        name: 'openai',
        apiKey,
        model,
        timeoutMs: env.LLM_TIMEOUT_MS,
        maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
        baseUrl: 'https://api.openai.com/v1',
      });
    case 'openrouter':
      return new OpenAiCompatibleProvider({
        name: 'openrouter',
        apiKey,
        model,
        timeoutMs: env.LLM_TIMEOUT_MS,
        maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
        baseUrl: 'https://openrouter.ai/api/v1',
        // Optional attribution shown on the OpenRouter dashboard.
        headers: { 'HTTP-Referer': 'https://tekrar.app', 'X-Title': 'Tekrar' },
      });
    case 'gemini':
      return new GeminiProvider(apiKey, model, env.LLM_TIMEOUT_MS, env.LLM_MAX_OUTPUT_TOKENS);
  }
}
