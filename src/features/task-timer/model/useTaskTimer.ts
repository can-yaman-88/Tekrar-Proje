import {
  formatElapsed,
  useLogManualSession,
  useRunningSession,
  useStartSession,
  useStopSession,
  useTaskSessions,
  type TaskSession,
} from '@entities/task-session';
import { elapsedMinutes } from '@entities/task-session';
import { showToast } from '@shared/lib/toast';
import { useCallback, useEffect, useMemo, useState } from 'react';

/** Minutes offered as one-tap manual entries. */
export const QUICK_MINUTES = [15, 25, 45] as const;

const totalMinutes = (sessions: readonly TaskSession[]): number =>
  sessions.reduce((sum, session) => sum + (session.minutes ?? 0), 0);

/**
 * The stopwatch for one task.
 *
 * The clock is server-side: `started_at` is a row, not a number in memory, so
 * closing the app, switching tasks or losing the network never loses the time.
 * The ticking label is the only local state.
 */
export function useTaskTimer(taskId: string, estimatedMinutes: number | null) {
  const runningQuery = useRunningSession();
  const sessionsQuery = useTaskSessions(taskId);
  const start = useStartSession();
  const stop = useStopSession();
  const logManual = useLogManualSession();

  const running = runningQuery.data ?? null;
  const runningHere = running && running.taskId === taskId ? running : null;
  // The clock is a value that advances, not a label pushed in from an effect:
  // the first render already shows the right time.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!runningHere) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [runningHere]);

  const elapsedLabel = runningHere ? formatElapsed(runningHere.startedAt, new Date(now)) : '00:00';

  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data]);
  const measured = useMemo(() => totalMinutes(sessions), [sessions]);

  const onStart = useCallback(() => {
    start.mutate(
      { taskId, startedAt: new Date().toISOString() },
      { onError: () => showToast('Zamanlayıcı başlatılamadı.', 'danger') },
    );
  }, [start, taskId]);

  const onStop = useCallback(() => {
    if (!runningHere) return;
    const minutes = elapsedMinutes(runningHere.startedAt);
    stop.mutate(
      { sessionId: runningHere.id, minutes },
      {
        onSuccess: () => showToast(`${minutes} dakika kaydedildi.`, 'success'),
        onError: () => showToast('Süre kaydedilemedi.', 'danger'),
      },
    );
  }, [runningHere, stop]);

  const onLogMinutes = useCallback(
    (minutes: number) => {
      logManual.mutate(
        { taskId, minutes },
        {
          onSuccess: () => showToast(`${minutes} dakika eklendi.`, 'success'),
          onError: () => showToast('Süre eklenemedi.', 'danger'),
        },
      );
    },
    [logManual, taskId],
  );

  // Estimate versus reality, stated plainly rather than as a percentage.
  const calibration = useMemo(() => {
    if (measured === 0 || !estimatedMinutes) return null;
    const diff = measured - estimatedMinutes;
    if (Math.abs(diff) < 5) return `Tahmin ${estimatedMinutes} dk, gerçek ${measured} dk — tahmin tuttu.`;
    return diff > 0
      ? `Tahmin ${estimatedMinutes} dk, gerçek ${measured} dk — ${diff} dk daha uzun sürdü.`
      : `Tahmin ${estimatedMinutes} dk, gerçek ${measured} dk — ${Math.abs(diff)} dk daha kısa sürdü.`;
  }, [estimatedMinutes, measured]);

  return {
    isRunning: runningHere !== null,
    /** A clock left running on some other task, so the student can be warned. */
    runningElsewhere: running !== null && running.taskId !== taskId,
    elapsedLabel,
    measuredMinutes: measured,
    sessionCount: sessions.filter((session) => session.endedAt !== null).length,
    calibration,
    quickMinutes: QUICK_MINUTES,
    isBusy: start.isPending || stop.isPending || logManual.isPending,
    onStart,
    onStop,
    onLogMinutes,
  };
}

export type TaskTimerController = ReturnType<typeof useTaskTimer>;
