import { z } from 'zod';

/** `{}` lists the usable models; `{ test: "<model id>" }` tries one out. */
export const LlmModelsRequestSchema = z.object({
  test: z.string().min(2).max(120).optional(),
});
export type LlmModelsRequest = z.infer<typeof LlmModelsRequestSchema>;

export const LlmModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Prompt price per million tokens, as reported by the provider. */
  promptPricePerMillion: z.number().nullable(),
  isFree: z.boolean(),
});
export type LlmModel = z.infer<typeof LlmModelSchema>;

export const LlmModelsResponseSchema = z.object({
  provider: z.enum(['openai', 'openrouter', 'gemini']),
  /** The project default, used when the student picks nothing. */
  defaultModel: z.string(),
  /** The student's current choice, if any. */
  selectedModel: z.string().nullable(),
  models: z.array(LlmModelSchema),
  /** Present when the request asked for a test. */
  test: z
    .object({
      model: z.string(),
      ok: z.boolean(),
      message: z.string(),
      ms: z.number().int(),
    })
    .nullable(),
});
export type LlmModelsResponse = z.infer<typeof LlmModelsResponseSchema>;
