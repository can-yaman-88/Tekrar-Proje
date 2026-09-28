import type { PostgrestError } from '@supabase/supabase-js';
import { AppError, type AppErrorKind } from './AppError';

// https://postgrest.org/en/stable/references/errors.html + Postgres SQLSTATE
const KIND_BY_CODE: Record<string, AppErrorKind> = {
  PGRST116: 'not_found', // .single() matched 0 rows
  PGRST301: 'unauthorized', // JWT expired / invalid
  PGRST303: 'unauthorized',
  '42501': 'unauthorized', // RLS violation / insufficient privilege
  '23505': 'conflict', // unique violation
  '23503': 'validation', // foreign key violation
  '23514': 'validation', // check violation
  '22P02': 'validation', // invalid text representation (bad uuid, enum)
  '55000': 'conflict', // object not in prerequisite state
};

export function fromPostgrestError(error: PostgrestError, operation: string): AppError {
  const byCode = KIND_BY_CODE[error.code];
  const kind: AppErrorKind =
    byCode ?? (error.code === '' && /fetch|network/i.test(error.message) ? 'network' : 'server');
  const message =
    kind === 'network' ? 'Bağlantı yok gibi görünüyor.' : kind === 'unauthorized' ? 'Oturumun sona erdi.' : error.message;
  return new AppError(kind, message, { cause: { operation, ...error } });
}
