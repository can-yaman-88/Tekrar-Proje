import { isMixedSet, taskKeys, taskMutationKeys, taskRepository, type Task } from '@entities/task';
import { reviewKeys, topicKeys } from '@entities/topic';
import { todayLocal } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { letterOf, runCompleteMixedSet, scoreHint, type CompleteMixedSetVariables } from './mixed-set';

export interface MixedSetRow {
  id: string;
  letter: string | null;
  topicTitle: string;
  problems: number;
  correct: number | null;
  hint: { text: string; tone: 'muted' | 'success' | 'danger' };
}

/**
 * Finishing a mixed set: one answer per topic — how many of its problems were
 * right — sent in one call that the offline queue can replay. The answers of
 * a set scored before are filled in, so a second look corrects rather than
 * starts over.
 */
export function useMixedSet() {
  const queryClient = useQueryClient();
  const [set, setSet] = useState<Task | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});

  const steps = useQuery({
    queryKey: taskKeys.subtasks(set?.id ?? 'none'),
    queryFn: () => taskRepository.listSubtasks(set?.id ?? ''),
    enabled: set !== null,
  });

  const mutation = useMutation<void, Error, CompleteMixedSetVariables>({
    mutationKey: taskMutationKeys.completeMixedSet,
    mutationFn: runCompleteMixedSet,
    onError: (error) => showToast(`${describeError(error).message} Puanlar kaydedilemedi.`, 'danger'),
    // Every topic's review schedule may have moved.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: taskKeys.all }),
        queryClient.invalidateQueries({ queryKey: topicKeys.all }),
        queryClient.invalidateQueries({ queryKey: reviewKeys.all }),
      ]),
  });

  const rows: MixedSetRow[] = useMemo(
    () =>
      (steps.data ?? []).map((step) => {
        const problems = step.targetCount ?? 0;
        const earlier = step.status === 'completed' && step.correctCount !== null ? step.correctCount : null;
        const correct = answers[step.id] ?? earlier;
        return {
          id: step.id,
          letter: letterOf(step),
          topicTitle: step.topic.title,
          problems,
          correct,
          hint: scoreHint(correct, problems),
        };
      }),
    [answers, steps.data],
  );

  const open = useCallback((task: Task) => {
    if (!isMixedSet(task)) return;
    setAnswers({});
    setSet(task);
  }, []);
  const close = useCallback(() => setSet(null), []);

  const { mutate } = mutation;
  const submit = useCallback(() => {
    if (!set || rows.length === 0 || rows.some((row) => row.correct === null)) return;
    const results = rows.map((row) => ({ taskId: row.id, correct: row.correct ?? 0 }));
    mutate({ setId: set.id, results, on: todayLocal() });
    const weak = rows.filter((row) => row.problems > 0 && (row.correct ?? 0) / row.problems < 0.6);
    const queued = onlineManager.isOnline() ? '' : ' Bağlantı gelince kaydedilecek.';
    showToast(
      (weak.length > 0
        ? `Set bitti. ${weak.map((row) => row.topicTitle).join(', ')} yarın yeniden karşına gelecek.`
        : 'Set bitti; konuların tekrar aralığı uzadı.') + queued,
      weak.length > 0 ? 'info' : 'success',
    );
    setSet(null);
  }, [mutate, rows, set]);

  return {
    visible: set !== null,
    title: set?.status === 'completed' ? 'Puanları düzelt' : 'Set nasıl geçti?',
    subtitle: set?.title ?? null,
    isLoading: steps.isPending && set !== null,
    error: steps.isError ? describeError(steps.error).message : null,
    rows,
    onAnswer: (stepId: string, correct: number) => setAnswers((current) => ({ ...current, [stepId]: correct })),
    canSubmit: rows.length > 0 && rows.every((row) => row.correct !== null),
    onSubmit: submit,
    onDismiss: close,
    open,
    isOpenFor: (taskId: string) => set?.id === taskId,
  };
}

export type MixedSetController = ReturnType<typeof useMixedSet>;
