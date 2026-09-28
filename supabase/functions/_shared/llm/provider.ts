import type { z } from 'zod';

/** An image handed to the model alongside the prompt. */
export interface ImagePart {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
}

export interface StructuredRequest<T> {
  system: string;
  user: string;
  /** Optional vision input; providers that cannot use it will simply ignore it. */
  images?: readonly ImagePart[];
  /** Validated after generation — provider output is never trusted as-is. */
  schema: z.ZodType<T>;
  schemaName: string;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
}

export type LlmProviderName = 'openai' | 'openrouter' | 'gemini';

export interface LlmProvider {
  readonly name: LlmProviderName;
  generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>;
}
