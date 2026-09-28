import { z } from 'zod';

const EnvSchema = z
  .object({
    SUPABASE_URL: z.url(),
    SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    LLM_PROVIDER: z.enum(['openai', 'openrouter', 'gemini']).default('openai'),
    LLM_MODEL: z.string().min(1).optional(),
    LLM_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    /**
     * Ceiling on the answer, in tokens. Sent explicitly because gateways that
     * bill per reservation (OpenRouter) otherwise reserve the model's whole
     * output window — tens of thousands of tokens — and reject the request
     * outright when the balance cannot cover a reservation that size. Our
     * answers are small structured JSON; 8k is already generous.
     */
    LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(512).max(32_000).default(8_192),
    OPENAI_API_KEY: z.string().min(1).optional(),
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    GEMINI_API_KEY: z.string().min(1).optional(),
  });
// The provider key is deliberately not required above: students supply their
// own from Settings, and a deployment may have none of its own. The
// missing-key error is raised by the call instead, where it can name the
// provider and tell the student where to fix it.

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/** Parsed once per isolate; a misconfigured deploy fails loudly on first request. */
export function getEnv(): Env {
  cached ??= EnvSchema.parse(Deno.env.toObject());
  return cached;
}
