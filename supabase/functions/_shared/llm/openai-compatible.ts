import { z } from 'zod';
import { LlmError } from '../errors.ts';
import { postJsonWithRetry } from './fetch-with-retry.ts';
import { assertPromptSize } from './guards.ts';
import { parseStructured, toStrictJsonSchema } from './json-schema.ts';
import type { ImagePart, LlmProvider, LlmProviderName, StructuredRequest, StructuredResult } from './provider.ts';

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

/** Chat Completions takes images as data URLs inside the user message. */
function userContent(text: string, images: readonly ImagePart[] | undefined): string | ContentPart[] {
  if (!images || images.length === 0) return text;
  return [
    { type: 'text', text },
    ...images.map((image): ContentPart => ({
      type: 'image_url',
      image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
    })),
  ];
}

const ChatCompletionSchema = z.object({
  model: z.string().optional(),
  error: z.object({ message: z.string(), code: z.union([z.number(), z.string()]).nullable().optional() }).optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable(),
        message: z.object({
          content: z.string().nullable(),
          refusal: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1)
    .optional(),
});

export interface OpenAiCompatibleOptions {
  /** 'openai' or any OpenAI-compatible gateway such as 'openrouter'. */
  name: LlmProviderName;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  baseUrl: string;
  /** Extra headers required by the gateway (OpenRouter's attribution headers). */
  headers?: Record<string, string>;
}

/** Chat Completions with strict JSON-schema structured outputs. */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: LlmProviderName;

  constructor(private readonly options: OpenAiCompatibleOptions) {
    this.name = options.name;
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    assertPromptSize(request.user);

    const raw = await postJsonWithRetry(
      `${this.options.baseUrl}/chat/completions`,
      { Authorization: `Bearer ${this.options.apiKey}`, ...this.options.headers },
      {
        model: this.options.model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: userContent(request.user, request.images) },
        ],
        max_tokens: this.options.maxOutputTokens,
        response_format: {
          type: 'json_schema',
          json_schema: { name: request.schemaName, strict: true, schema: toStrictJsonSchema(request.schema) },
        },
      },
      { attempts: 3, timeoutMs: this.options.timeoutMs },
    );

    const parsed = ChatCompletionSchema.safeParse(raw);
    if (!parsed.success)
      throw new LlmError('invalid_output', `Unexpected ${this.name} response shape.`, { cause: parsed.error });

    // OpenRouter can report upstream failures in a 200 response body.
    if (parsed.data.error) throw new LlmError('unavailable', `Gateway error: ${parsed.data.error.message}`);

    const [choice] = parsed.data.choices ?? [];
    if (choice?.message.refusal) throw new LlmError('refused', `Model refused: ${choice.message.refusal}`);
    if (choice?.finish_reason === 'length') throw new LlmError('invalid_output', 'Model output was truncated.');
    if (!choice?.message.content) throw new LlmError('invalid_output', 'Model returned empty content.');

    return { data: parseStructured(choice.message.content, request.schema), model: parsed.data.model ?? this.options.model };
  }
}
