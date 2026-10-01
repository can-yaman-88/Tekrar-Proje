import { ApiErrorResponseSchema, type ApiErrorCode } from '@contracts/http.contract';
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';
import type { z } from 'zod';
import { AppError, type AppErrorKind } from '../../lib/errors';
import { supabase } from './client';

export type EdgeFunctionName = 'daily-checkin' | 'ingest-syllabus' | 'generate-weekly-plan' | 'llm-models';

/** LLM calls are slow, but never this slow: past this the user gets a real error. */
const FUNCTION_TIMEOUT_MS = 90_000;

function withTimeout<T>(work: Promise<T>, name: EdgeFunctionName): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new AppError('network', 'Sunucu zamanında yanıt vermedi. Tekrar dene.')),
      FUNCTION_TIMEOUT_MS,
    );
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

const KIND_BY_API_CODE: Record<ApiErrorCode, AppErrorKind> = {
  bad_request: 'validation',
  unauthorized: 'unauthorized',
  not_found: 'not_found',
  conflict: 'conflict',
  method_not_allowed: 'server',
  llm_unavailable: 'server',
  llm_invalid_output: 'validation',
  rate_limited: 'rate_limited',
  internal: 'server',
};

async function toAppErrorFromFunctions(error: unknown): Promise<AppError> {
  if (error instanceof FunctionsHttpError) {
    const response: unknown = error.context;
    if (response instanceof Response) {
      const body: unknown = await response.json().catch(() => null);
      const parsed = ApiErrorResponseSchema.safeParse(body);
      if (parsed.success) {
        const { code, message, requestId } = parsed.data.error;
        return new AppError(KIND_BY_API_CODE[code], message, { cause: error, requestId });
      }
      if (response.status === 429) return new AppError('rate_limited', 'Çok fazla istek gönderildi.', { cause: error });
    }
    return new AppError('server', 'Sunucu bir hata döndürdü.', { cause: error });
  }
  if (error instanceof FunctionsFetchError) return new AppError('network', 'Bağlantı yok gibi görünüyor.', { cause: error });
  if (error instanceof FunctionsRelayError) return new AppError('server', 'Sunucuya ulaşılamıyor.', { cause: error });
  return new AppError('unknown', 'Sunucu çağrısında beklenmeyen hata.', { cause: error });
}

/** Calls an Edge Function and validates its response against the shared contract. */
export async function invokeEdgeFunction<TResponse>(
  name: EdgeFunctionName,
  body: Record<string, unknown>,
  responseSchema: z.ZodType<TResponse>,
  headers?: Record<string, string>,
): Promise<TResponse> {
  const { data, error } = await withTimeout(supabase.functions.invoke<unknown>(name, { body, headers }), name);
  if (error) throw await toAppErrorFromFunctions(error);

  const parsed = responseSchema.safeParse(data);
  if (!parsed.success) throw new AppError('server', 'Sunucudan beklenmeyen yanıt geldi.', { cause: parsed.error });
  return parsed.data;
}
