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
  /**
   * This request's own output limit, when it needs less than the deployment's.
   * Every output token is paid for up front at the worst case, so a reader
   * that writes a page should not reserve for a book.
   */
  maxOutputTokens?: number;
  /**
   * When the answer fails `schema` as a whole: keep the parts that pass on
   * their own. Returns null when there is nothing worth keeping.
   */
  salvage?: (json: unknown) => { data: T; droppedItems: number } | null;
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
