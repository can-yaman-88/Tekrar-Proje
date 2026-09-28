import { ZodError } from 'zod';
import type { ApiErrorResponse } from './contracts/http.contract.ts';
import { errorMessage, HttpError, LlmError } from './errors.ts';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export interface Logger {
  info(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}

export interface RequestContext {
  requestId: string;
  log: Logger;
}

function createLogger(requestId: string, fn: string): Logger {
  const write = (level: 'info' | 'error', event: string, data?: Record<string, unknown>) =>
    console[level](JSON.stringify({ level, fn, requestId, event, ...data }));
  return {
    info: (event, data) => write('info', event, data),
    error: (event, data) => write('error', event, data),
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch (cause) {
    throw new HttpError('bad_request', 'Request body must be valid JSON.', { cause });
  }
}

function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof LlmError) return error.toHttpError();
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const where = issue?.path.join('.') || 'body';
    return new HttpError('bad_request', `Invalid ${where}: ${issue?.message ?? 'validation failed'}`, { cause: error });
  }
  return new HttpError('internal', 'Unexpected server error.', { cause: error });
}

/** Wraps a POST handler with CORS, request ids, structured logs and the error envelope. */
export function createHandler(
  fn: string,
  handler: (req: Request, ctx: RequestContext) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
    const log = createLogger(requestId, fn);

    try {
      if (req.method !== 'POST') throw new HttpError('method_not_allowed', 'Use POST.');
      return await handler(req, { requestId, log });
    } catch (error) {
      const httpError = toHttpError(error);
      log.error('request_failed', {
        code: httpError.code,
        status: httpError.status,
        message: errorMessage(error),
        cause: httpError.cause === undefined ? undefined : errorMessage(httpError.cause),
      });
      const body: ApiErrorResponse = {
        error: { code: httpError.code, message: httpError.message, requestId },
      };
      return jsonResponse(body, httpError.status);
    }
  };
}
