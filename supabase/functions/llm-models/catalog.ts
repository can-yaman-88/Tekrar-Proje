// Which models the student may choose from.
//
// OpenRouter publishes its catalogue, so the list is fetched and filtered down
// to models that can actually return strict JSON — everything in this app
// depends on structured output. Other providers get a short curated list.
import { z } from 'zod';
import type { LlmModel } from '../_shared/contracts/llm-models.contract.ts';
import type { Env } from '../_shared/env.ts';

const OpenRouterModelsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string().optional(),
      supported_parameters: z.array(z.string()).optional(),
      pricing: z.object({ prompt: z.string().optional() }).optional(),
    }),
  ),
});

const CURATED: Record<'openai' | 'gemini', LlmModel[]> = {
  openai: [
    { id: 'gpt-5-mini', name: 'GPT-5 mini', promptPricePerMillion: null, isFree: false },
    { id: 'gpt-5', name: 'GPT-5', promptPricePerMillion: null, isFree: false },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', promptPricePerMillion: null, isFree: false },
  ],
  gemini: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', promptPricePerMillion: null, isFree: false },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', promptPricePerMillion: null, isFree: false },
  ],
};

/**
 * Every model that can return structured output — all of them, not a first
 * page. The list used to stop at 120, and since it is sorted free-first and
 * then by name, most paid models past the letter "G" could never be chosen.
 * The phone pages and searches through it; the server does not cut it.
 *
 * @param apiKeyOverride the student's own key, when they set one.
 * @param inUse the model the app is actually calling. It is always in the list,
 *        even when the catalogue no longer carries it, so the student can see
 *        what every call goes through.
 */
export async function listModels(
  env: Env,
  apiKeyOverride?: string | null,
  inUse?: string | null,
): Promise<LlmModel[]> {
  if (env.LLM_PROVIDER !== 'openrouter') return CURATED[env.LLM_PROVIDER];

  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${apiKeyOverride?.trim() || env.OPENROUTER_API_KEY || ''}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return [];

  const parsed = OpenRouterModelsSchema.safeParse(await response.json());
  if (!parsed.success) return [];

  const models = parsed.data.data
    .filter((model) => {
      const params = model.supported_parameters ?? [];
      // Both names appear in the catalogue depending on the provider.
      return params.includes('structured_outputs') || params.includes('response_format');
    })
    .map((model) => {
      const prompt = Number(model.pricing?.prompt ?? 'NaN');
      const perMillion = Number.isFinite(prompt) ? Math.round(prompt * 1_000_000 * 100) / 100 : null;
      return {
        id: model.id,
        name: model.name ?? model.id,
        promptPricePerMillion: perMillion,
        isFree: perMillion === 0 || model.id.endsWith(':free'),
      };
    })
    .sort((a, b) => Number(b.isFree) - Number(a.isFree) || a.name.localeCompare(b.name));

  const current = inUse?.trim();
  if (current && !models.some((model) => model.id === current)) {
    models.unshift({ id: current, name: current, promptPricePerMillion: null, isFree: false });
  }
  return models;
}
