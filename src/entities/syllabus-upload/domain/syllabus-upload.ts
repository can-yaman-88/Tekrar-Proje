import type { ProcessingStatus } from '@contracts/enums.contract';

export interface SyllabusUpload {
  id: string;
  filename: string;
  storagePath: string;
  status: ProcessingStatus;
  errorMessage: string | null;
  courseId: string | null;
  createdAt: string;
}

export const isUploadPending = (upload: SyllabusUpload): boolean =>
  upload.status === 'pending' || upload.status === 'processing';

/** A success stops being news quickly; a failure gets a day to be noticed. */
const SUCCESS_VISIBLE_MS = 10 * 60_000;
const FAILURE_VISIBLE_MS = 24 * 60 * 60_000;

/**
 * The list is a status board, not a log. Work in progress always shows; a
 * failure shows until it is dismissed or a day passes; a success disappears
 * shortly after it has been seen.
 */
export function isUploadVisible(upload: SyllabusUpload, now: number = Date.now()): boolean {
  if (upload.status === 'pending' || upload.status === 'processing') return true;
  const age = now - Date.parse(upload.createdAt);
  return upload.status === 'failed' ? age < FAILURE_VISIBLE_MS : age < SUCCESS_VISIBLE_MS;
}
