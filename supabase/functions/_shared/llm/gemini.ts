import { z } from 'zod';
import { LlmError } from '../errors.ts';
import { postJsonWithRetry } from './fetch-with-retry.ts';
import { assertPromptSize } from './guards.ts';
import { parseStructured, toStrictJsonSchema } from './json-schema.ts';
import type { LlmProvider, StructuredRequest, StructuredResult } from './provider.ts';

const GenerateContentSchema = z.object({
  candidates: z
    .array(
      z.object({
        finishReason: z.string().optional(),
        content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }).optional(),
      }),
    )
    .optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  modelVersion: z.string().optional(),
});

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs: number,
    private readonly maxOutputTokens: number,
  ) {}

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    assertPromptSize(request.user);

    const raw = await postJsonWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      { 'x-goog-api-key': this.apiKey },
      {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [
          {
            role: 'user',
            parts: [
              { text: request.user },
              // Gemini takes images as inline base64 parts.
              ...(request.images ?? []).map((image) => ({
                inlineData: { mimeType: image.mimeType, data: image.base64 },
              })),
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: toStrictJsonSchema(request.schema),
          maxOutputTokens: Math.min(request.maxOutputTokens ?? this.maxOutputTokens, this.maxOutputTokens),
        },
      },
      { attempts: 3, timeoutMs: this.timeoutMs },
    );

    const parsed = GenerateContentSchema.safeParse(raw);
    if (!parsed.success) throw new LlmError('invalid_output', 'Unexpected Gemini response shape.', { cause: parsed.error });

    const blockReason = parsed.data.promptFeedback?.blockReason;
    if (blockReason) throw new LlmError('refused', `Prompt blocked: ${blockReason}`);

    const candidate = parsed.data.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS') throw new LlmError('invalid_output', 'Model output was truncated.');
    const text = candidate?.content?.parts.map((p) => p.text ?? '').join('') ?? '';
    if (!text) throw new LlmError('invalid_output', `Model returned no content (${candidate?.finishReason ?? 'unknown'}).`);

    return { data: parseStructured(text, request.schema, request.salvage), model: parsed.data.modelVersion ?? this.model };
  }
}
