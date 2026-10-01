import type { ApiErrorCode } from './contracts/http.contract.ts';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  llm_invalid_output: 422,
  llm_unavailable: 503,
  rate_limited: 429,
  internal: 500,
};

/** An error whose message is safe to return to the client. */
export class HttpError extends Error {
  readonly status: number;

  constructor(
    readonly code: ApiErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'HttpError';
    this.status = STATUS_BY_CODE[code];
  }
}

export type LlmErrorKind = 'unavailable' | 'invalid_output' | 'refused';

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    /**
     * `hint` is the one part of the failure the student can act on — a missing
     * key, an empty balance. It is written for them, in their language, and is
     * the only internal detail allowed out; `message` stays in the logs.
     */
    options?: { cause?: unknown; hint?: string },
  ) {
    super(message, options);
    this.name = 'LlmError';
    this.hint = options?.hint;
  }

  readonly hint: string | undefined;

  toHttpError(): HttpError {
    if (this.kind === 'unavailable') {
      return new HttpError(
        'llm_unavailable',
        this.hint ?? 'Yapay zekâ servisi şu an yanıt vermiyor. Az sonra tekrar dene.',
        { cause: this },
      );
    }
    return new HttpError(
      'llm_invalid_output',
      this.hint ?? 'Yapay zekâ yanıtı beklenen biçimde gelmedi. Tekrar dene.',
      { cause: this },
    );
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
