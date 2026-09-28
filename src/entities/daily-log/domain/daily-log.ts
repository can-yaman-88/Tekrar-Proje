import type { AttachmentMime, IsoDate } from '@contracts/enums.contract';

export interface NewDailyLog {
  logDate: IsoDate;
  rawText: string;
}

/** One past check-in, with what it did to the plan. */
export interface CheckinRecord {
  id: string;
  logDate: IsoDate;
  rawText: string;
  summary: string | null;
  createdAt: string;
  revertedAt: string | null;
  taskChanges: number;
  /** Tasks this check-in removed from the plan. */
  removedTasks: number;
  topicChanges: number;
  createdTasks: number;
}

export interface CheckinTaskChange {
  id: string;
  taskTitle: string;
  previousStatus: string;
  /** null when the task was deleted outright rather than moved to a new status. */
  newStatus: string | null;
  note: string | null;
  problemsSolved: number | null;
}

export const isRevertable = (record: CheckinRecord): boolean => record.revertedAt === null;

/** A file the student attached to a check-in, after upload. */
export interface CheckinAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

/** A file picked on the device, before upload. */
export interface NewAttachment {
  objectName: string;
  filename: string;
  mimeType: AttachmentMime;
  sizeBytes: number;
  bytes: ArrayBuffer;
}
