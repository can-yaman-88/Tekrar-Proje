export type AppErrorKind =
  | 'network'
  | 'unauthorized'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'rate_limited'
  | 'server'
  | 'unknown';

const RETRYABLE: ReadonlySet<AppErrorKind> = new Set(['network', 'rate_limited', 'server']);

/** The single error type that crosses from the data layer into hooks and UI. */
export class AppError extends Error {
  readonly requestId: string | undefined;

  constructor(
    readonly kind: AppErrorKind,
    message: string,
    options?: { cause?: unknown; requestId?: string },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.requestId = options?.requestId;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

const NETWORK_MESSAGE = /network request failed|failed to fetch|fetch failed|timeout|aborted/i;

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error && NETWORK_MESSAGE.test(error.message)) {
    return new AppError('network', 'Bağlantı yok gibi görünüyor.', { cause: error });
  }
  return new AppError('unknown', 'Bir şeyler ters gitti.', { cause: error });
}
