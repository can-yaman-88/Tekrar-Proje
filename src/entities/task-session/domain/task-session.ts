import type { TaskType } from '@contracts/enums.contract';

/**
 * Which clock measured a stretch: Tekrar's own stopwatch on the task screen,
 * or the Focus Timer app with this task picked.
 */
export type SessionClock = 'stopwatch' | 'focus_timer';

/** A stretch of real study time against one task. */
export interface TaskSession {
  id: string;
  taskId: string;
  startedAt: string;
  endedAt: string | null;
  minutes: number | null;
  clock: SessionClock;
}

/** A closed session together with the work it measured. */
export interface MeasuredWork {
  sessionId: string;
  taskId: string;
  taskType: TaskType;
  startedAt: string;
  minutes: number;
  estimatedMinutes: number | null;
}

/** Longer than this and the student clearly forgot to stop the clock. */
export const MAX_SESSION_MINUTES = 240;

export function elapsedMinutes(startedAt: string, now: Date = new Date()): number {
  const ms = now.getTime() - new Date(startedAt).getTime();
  return Math.max(0, Math.round(ms / 60_000));
}

/** mm:ss while the clock is short, h:mm:ss once it passes an hour. */
export function formatElapsed(startedAt: string, now: Date = new Date()): string {
  const total = Math.max(0, Math.floor((now.getTime() - new Date(startedAt).getTime()) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** Minutes of the closed sessions in a list. */
export const sumMinutes = (sessions: readonly TaskSession[]): number =>
  sessions.reduce((sum, session) => sum + (session.minutes ?? 0), 0);
