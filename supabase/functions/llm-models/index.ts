// POST /functions/v1/llm-models
//   {}                  → usable models + the current choice
//   { test: "<model>" } → same, plus the result of a real structured-output call
//
// The provider key never leaves the server: the app only ever sees model ids.
import { z } from 'zod';
import {
  LlmModelsRequestSchema,
  type LlmModelsResponse,
} from '../_shared/contracts/llm-models.contract.ts';
import { getEnv } from '../_shared/env.ts';
import { errorMessage } from '../_shared/errors.ts';
import { createHandler, jsonResponse, readJson } from '../_shared/http.ts';
import { createLlmProvider } from '../_shared/llm/index.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { authenticate, createServiceClient } from '../_shared/supabase.ts';
import { readUserLlmSettings } from '../_shared/user-model.ts';
import { listModels } from './catalog.ts';

const DEFAULT_MODELS = { openai: 'gpt-5-mini', openrouter: 'google/gemini-2.5-flash', gemini: 'gemini-2.5-flash' };

/** The failures a student actually meets, in their own language. */
function explainFailure(raw: string): string {
  if (/HTTP 402|more credits|insufficient/i.test(raw)) {
    return 'OpenRouter bakiyesi bu model için yetmedi. Kredi ekle ya da ücretsiz bir model seç.';
  }
  if (/HTTP 401|HTTP 403|No auth credentials|invalid api key/i.test(raw)) {
    return 'Anahtar geçersiz ya da bu modele yetkisi yok. Yukarıdan anahtarını güncelleyebilirsin.';
  }
  if (/no api key configured/i.test(raw)) {
    return 'Anahtar tanımlı değil. Yukarıdaki alandan OpenRouter anahtarını gir.';
  }
  if (/429|rate limit|quota/i.test(raw)) {
    return 'Model şu an kota sınırında (ücretsiz modellerde sık olur). Biraz sonra dene ya da başka bir model seç.';
  }
  if (/not a valid model|no endpoints|404/i.test(raw)) return 'Bu model sağlayıcıda bulunamadı.';
  if (/invalid_output|failed validation|non-JSON/i.test(raw)) {
    return 'Model yapılandırılmış çıktı döndüremedi; bu uygulama için uygun değil.';
  }
  if (/refused|blocked/i.test(raw)) return 'Model isteği reddetti.';
  if (/unavailable|timeout|network/i.test(raw)) return 'Sağlayıcıya ulaşılamadı. Bağlantıyı ve modeli kontrol et.';
  return raw.slice(0, 200);
}

/** Deliberately tiny: enough to prove the model returns strict JSON. */
const ProbeSchema = z.object({
  ok: z.boolean().describe('Always true.'),
  language: z.string().describe('The word "türkçe".'),
});

Deno.serve(
  createHandler('llm-models', async (req, { log, identify }) => {
    const env = getEnv();
    const service = createServiceClient(env);
    const { userId } = await authenticate(req, env, service);
    identify(userId);
    const { test } = LlmModelsRequestSchema.parse(await readJson(req));
    await enforceRateLimit(service, userId, test ? 'llm_test' : 'llm_models');

    // The list must reflect the key that will pay for the calls, so the
    // student's own key is used for the catalogue too.
    const settings = await readUserLlmSettings(service, userId);
    const selectedModel = settings.model;
    const models = await listModels(env, settings.apiKey, selectedModel ?? env.LLM_MODEL ?? null);

    let result: LlmModelsResponse['test'] = null;
    if (test) {
      const startedAt = performance.now();
      try {
        const llm = createLlmProvider(env, test, settings.apiKey);
        await llm.generateStructured({
          system: 'You answer with strict JSON only.',
          user: 'Set ok to true and language to "türkçe".',
          schema: ProbeSchema,
          schemaName: 'probe',
        });
        result = {
          model: test,
          ok: true,
          message: 'Model çalışıyor ve yapılandırılmış çıktı döndürüyor.',
          ms: Math.round(performance.now() - startedAt),
        };
      } catch (error) {
        result = {
          model: test,
          ok: false,
          message: explainFailure(errorMessage(error)),
          ms: Math.round(performance.now() - startedAt),
        };
      }
      log.info('model_test', { model: test, ok: result.ok, ms: result.ms });
    }

    const body: LlmModelsResponse = {
      provider: env.LLM_PROVIDER,
      defaultModel: env.LLM_MODEL ?? DEFAULT_MODELS[env.LLM_PROVIDER],
      selectedModel,
      models,
      test: result,
    };
    return jsonResponse(body);
  }),
);
