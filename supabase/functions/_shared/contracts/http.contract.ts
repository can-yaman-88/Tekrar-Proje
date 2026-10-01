// Error envelope returned by every Edge Function.
import { z } from 'zod';

export const ApiErrorCodeSchema = z.enum([
  'bad_request',
  'unauthorized',
  'not_found',
  'conflict',
  'method_not_allowed',
  'llm_unavailable',
  'llm_invalid_output',
  'rate_limited',
  'internal',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    requestId: z.string(),
  }),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
