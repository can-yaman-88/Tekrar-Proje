import type { SessionClock, TaskSession } from '@entities/task-session';
import { formatMinutes, formatShortDate, localDateOf } from '@shared/lib/date';

/** Minutes offered as one-tap manual entries. */
export const QUICK_MINUTES = [15, 25, 45] as const;
/** The same ceiling the stopwatch and the server use. */
export const MAX_MANUAL_MINUTES = 240;

export const CLOCK_LABEL: Record<SessionClock, string> = {
  stopwatch: 'Zamanlayıcı',
  focus_timer: 'Focus Timer',
};

export interface SessionRowModel {
  id: string;
  clock: SessionClock;
  /** "2 Eki 14:05" */
  whenLabel: string;
  minutesLabel: string;
  /** "Focus Timer · Feynman sayfası" — the step, for a group task. */
  detail: string;
}

export interface StepTimeModel {
  id: string;
  title: string;
  minutesLabel: string;
  isDone: boolean;
}

export interface EstimateModel {
  /** 0–1 (capped) for the bar. */
  ratio: number;
  isOver: boolean;
  /** "45 dk tahminin 38 dk'sı geçti · 7 dk kaldı" */
  label: string;
}

const hhmm = (iso: string): string => {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

export function sessionRow(session: TaskSession, stepTitles: ReadonlyMap<string, string>): SessionRowModel {
  const step = stepTitles.get(session.taskId);
  return {
    id: session.id,
    clock: session.clock,
    whenLabel: `${formatShortDate(localDateOf(session.startedAt))} ${hhmm(session.startedAt)}`,
    minutesLabel: formatMinutes(session.minutes ?? 0),
    detail: [CLOCK_LABEL[session.clock], step].filter(Boolean).join(' · '),
  };
}

/**
 * Measured time against the estimate, in words. While the work is open it
 * says what is left; once it is finished it says how the estimate held up —
 * the number the planner learns from.
 */
export function estimateModel(measured: number, estimate: number | null, isOpen: boolean): EstimateModel | null {
  if (!estimate || estimate <= 0) return null;
  const diff = measured - estimate;
  const isOver = diff > 0;
  let label: string;
  if (measured === 0) {
    label = `Tahmin ${formatMinutes(estimate)}; henüz süre ölçülmedi.`;
  } else if (isOpen) {
    label = isOver
      ? `Tahmin ${formatMinutes(estimate)}, ${formatMinutes(measured)} çalışıldı — ${formatMinutes(diff)} aştı.`
      : `Tahmin ${formatMinutes(estimate)}, ${formatMinutes(measured)} çalışıldı — ${formatMinutes(-diff)} kaldı.`;
  } else if (Math.abs(diff) < 5) {
    label = `Tahmin ${formatMinutes(estimate)}, gerçek ${formatMinutes(measured)} — tahmin tuttu.`;
  } else {
    label = isOver
      ? `Tahmin ${formatMinutes(estimate)}, gerçek ${formatMinutes(measured)} — ${formatMinutes(diff)} daha uzun sürdü.`
      : `Tahmin ${formatMinutes(estimate)}, gerçek ${formatMinutes(measured)} — ${formatMinutes(-diff)} daha kısa sürdü.`;
  }
  return { ratio: Math.min(1, measured / estimate), isOver, label };
}

/** Parses a typed minute count; null when it is not a usable entry. */
export function parseManualMinutes(text: string): number | null {
  const value = Number.parseInt(text.trim(), 10);
  return Number.isFinite(value) && value >= 1 && value <= MAX_MANUAL_MINUTES ? value : null;
}
