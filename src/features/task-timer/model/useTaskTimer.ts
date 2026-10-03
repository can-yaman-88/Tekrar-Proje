import {
  focusTimerSupported,
  openTaskInFocusTimer,
  useFocusTimerDevices,
  type TimerTaskTarget,
} from '@entities/focus-timer';
import { courseLabel } from '@entities/course';
import { taskKeys, taskRepository, type Task } from '@entities/task';
import {
  elapsedMinutes,
  formatElapsed,
  sumMinutes,
  useDeleteSession,
  useLogManualSession,
  useRunningSession,
  useStartSession,
  useStopSession,
  useTaskSessions,
  type TaskSession,
} from '@entities/task-session';
import { formatMinutes, formatShortDate, localDateOf } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import {
  estimateModel,
  parseManualMinutes,
  QUICK_MINUTES,
  sessionRow,
  type SessionRowModel,
  type StepTimeModel,
} from './task-timer.model';

/** Sessions listed before "tümünü göster". */
const VISIBLE_SESSIONS = 4;

const isOpenStatus = (task: Task): boolean => task.status === 'pending' || task.status === 'in_progress';

/**
 * The study time of one task, from both clocks.
 *
 * Tekrar's own stopwatch lives on the server (`started_at` is a row), so
 * closing the app, switching tasks or losing the network never loses the
 * time; the ticking label is the only local state. Focus Timer stretches filed
 * under this task arrive on their own and are listed with the rest.
 *
 * A group task is a container: its steps carry the work, so its card adds up
 * the steps' time as well and shows it step by step.
 */
export function useTaskTimer(task: Task | null) {
  const taskId = task?.id ?? '';
  const mayHaveSteps = task !== null && task.parentTaskId === null;
  // Same key as the steps section: one request, one cache.
  const stepsQuery = useQuery({
    queryKey: taskKeys.subtasks(taskId),
    queryFn: () => taskRepository.listSubtasks(taskId),
    enabled: mayHaveSteps,
  });
  const steps = useMemo(() => (mayHaveSteps ? (stepsQuery.data ?? []) : []), [mayHaveSteps, stepsQuery.data]);
  const isGroup = steps.length > 0;

  const taskIds = useMemo(() => (task ? [task.id, ...steps.map((step) => step.id)] : []), [steps, task]);
  const sessionsQuery = useTaskSessions(taskIds);
  const runningQuery = useRunningSession();
  const timerDevices = useFocusTimerDevices({ enabled: focusTimerSupported });
  const start = useStartSession();
  const stop = useStopSession();
  const logManual = useLogManualSession();
  const remove = useDeleteSession();

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

  const [showAll, setShowAll] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');

  const closed = useMemo(
    () => (sessionsQuery.data ?? []).filter((session) => session.endedAt !== null && (session.minutes ?? 0) > 0),
    [sessionsQuery.data],
  );
  const measured = sumMinutes(closed);
  const liveMinutes = runningHere ? elapsedMinutes(runningHere.startedAt, new Date(now)) : 0;
  const isOpen = task !== null && isOpenStatus(task);

  const stepTitles = useMemo(() => new Map(steps.map((step) => [step.id, step.title])), [steps]);
  const rows: SessionRowModel[] = useMemo(() => closed.map((session) => sessionRow(session, stepTitles)), [closed, stepTitles]);

  const stepTimes: StepTimeModel[] = useMemo(
    () =>
      steps.map((step) => ({
        id: step.id,
        title: step.title,
        minutesLabel: formatMinutes(sumMinutes(closed.filter((session) => session.taskId === step.id))),
        isDone: step.status === 'completed',
      })),
    [closed, steps],
  );

  // A group's own estimate is the steps' total once it is shared out among them.
  const estimate = isGroup
    ? steps.reduce((sum, step) => sum + (step.estimatedMinutes ?? 0), 0) || (task?.estimatedMinutes ?? null)
    : (task?.estimatedMinutes ?? null);
  const estimateView = estimateModel(measured + liveMinutes, estimate, isOpen);

  // Focus Timer: the work itself, or for a group the next open step.
  const timerTarget: TimerTaskTarget | null = useMemo(() => {
    if (!task || !isOpen) return null;
    const work = isGroup ? steps.find(isOpenStatus) : task;
    if (!work) return null;
    return {
      taskId: work.id,
      taskTitle: work.title,
      topicId: task.topic.id,
      topicTitle: task.topic.title,
      courseId: task.course.id,
      courseLabel: courseLabel(task.course),
    };
  }, [isGroup, isOpen, steps, task]);
  const canUseFocusTimer = focusTimerSupported && (timerDevices.data?.length ?? 0) > 0 && timerTarget !== null;

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
        onSuccess: () => showToast(`${formatMinutes(minutes)} kaydedildi.`, 'success'),
        onError: () => showToast('Süre kaydedilemedi.', 'danger'),
      },
    );
  }, [runningHere, stop]);

  const discard = useCallback(
    (session: Pick<TaskSession, 'id' | 'clock'>, done: string) =>
      remove.mutate(
        { session },
        {
          onSuccess: () => showToast(done, 'success'),
          onError: (error) => showToast(describeError(error).message, 'danger'),
        },
      ),
    [remove],
  );

  const onDiscardRunning = useCallback(() => {
    if (!runningHere) return;
    Alert.alert('Sayaç silinsin mi?', 'Bu oturum kaydedilmeden kapanır.', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => discard(runningHere, 'Oturum silindi.') },
    ]);
  }, [discard, runningHere]);

  const onDeleteSession = useCallback(
    (row: SessionRowModel) => {
      const fromTimer = row.clock === 'focus_timer';
      Alert.alert(
        'Oturum silinsin mi?',
        `${row.whenLabel} · ${row.minutesLabel}${
          fromTimer ? '\n\nFocus Timer’daki kaydı telefonda kalır; orada düzenlersen yeniden gelir.' : ''
        }`,
        [
          { text: 'Vazgeç', style: 'cancel' },
          { text: 'Sil', style: 'destructive', onPress: () => discard(row, 'Oturum silindi.') },
        ],
      );
    },
    [discard],
  );

  const onLogMinutes = useCallback(
    (minutes: number) => {
      logManual.mutate(
        { taskId, minutes },
        {
          onSuccess: () => {
            setCustomOpen(false);
            setCustomText('');
            showToast(`${formatMinutes(minutes)} eklendi.`, 'success');
          },
          onError: () => showToast('Süre eklenemedi.', 'danger'),
        },
      );
    },
    [logManual, taskId],
  );

  const customMinutes = parseManualMinutes(customText);
  const onLogCustom = useCallback(() => {
    if (customMinutes !== null) onLogMinutes(customMinutes);
  }, [customMinutes, onLogMinutes]);

  const [isOpening, setOpening] = useState(false);
  const onOpenFocusTimer = useCallback(async () => {
    if (!timerTarget) return;
    setOpening(true);
    try {
      const outcome = await openTaskInFocusTimer(timerTarget);
      if (outcome === 'missing') {
        showToast('Focus Timer açılamadı. Telefonda güncel sürümü yüklü olmalı.', 'danger');
      }
    } finally {
      setOpening(false);
    }
  }, [timerTarget]);

  const latest = closed[0];
  const summary =
    closed.length === 0
      ? null
      : `${closed.length} oturum · son ${formatShortDate(localDateOf(latest?.startedAt ?? ''))}${
          isGroup ? ' · adımlar dahil' : ''
        }`;

  return {
    isLoading: sessionsQuery.isPending && sessionsQuery.data === undefined && taskIds.length > 0,
    isOpen,
    isGroup,
    isRunning: runningHere !== null,
    /** A stopwatch left running on some other task, so the student can be warned. */
    runningElsewhere: running !== null && running.taskId !== taskId,
    elapsedLabel: runningHere ? formatElapsed(runningHere.startedAt, new Date(now)) : '00:00',
    totalLabel: formatMinutes(measured + liveMinutes),
    hasTime: measured + liveMinutes > 0,
    summary,
    estimate: estimateView,
    stepTimes,
    sessions: showAll ? rows : rows.slice(0, VISIBLE_SESSIONS),
    hiddenSessions: showAll ? 0 : Math.max(0, rows.length - VISIBLE_SESSIONS),
    onShowAll: () => setShowAll(true),
    quickMinutes: QUICK_MINUTES,
    custom: {
      isOpen: customOpen,
      text: customText,
      isValid: customMinutes !== null,
      onOpen: () => setCustomOpen(true),
      onClose: () => {
        setCustomOpen(false);
        setCustomText('');
      },
      onChangeText: (text: string) => setCustomText(text.replace(/[^0-9]/g, '').slice(0, 3)),
      onSubmit: onLogCustom,
    },
    focusTimer: canUseFocusTimer
      ? {
          label: isGroup && timerTarget ? `Focus Timer’da çalış: ${timerTarget.taskTitle}` : 'Focus Timer’da çalış',
          isOpening,
          onOpen: () => void onOpenFocusTimer(),
        }
      : null,
    isBusy: start.isPending || stop.isPending || logManual.isPending,
    isRemoving: remove.isPending,
    onStart,
    onStop,
    onDiscardRunning,
    onDeleteSession,
    onLogMinutes,
  };
}

export type TaskTimerController = ReturnType<typeof useTaskTimer>;
