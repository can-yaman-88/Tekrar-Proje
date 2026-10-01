import type { IsoDate } from '@contracts/enums.contract';
import {
  isReviewTask,
  nextStatusOnToggle,
  type Task,
  taskKeys,
  taskMutationKeys,
  taskRepository,
  type TaskStatus,
  withStatus,
} from '@entities/task';
import { reviewKeys, topicKeys } from '@entities/topic';
import { describeError } from '@shared/lib/errors';
import { todayLocal } from '@shared/lib/date';
import { showToast } from '@shared/lib/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

interface ToggleContext {
  previous: Task[] | undefined;
}

/** What a status change carries; persisted as-is by the offline queue. */
export interface ToggleVariables {
  task: Task;
  status: TaskStatus;
  /** The day the student did it — a change replayed tomorrow still counts for today. */
  on: IsoDate;
  /** 1–5 when they rated how it went (review tasks ask). */
  confidence: number | null;
}

const isToggleVariables = (value: unknown): value is ToggleVariables =>
  typeof value === 'object' && value !== null && 'task' in value && 'status' in value;

/**
 * Sends a queued status change. Mutations persisted by an older version of
 * the app carry the bare task instead; those still mean "flip it".
 */
export function runToggle(variables: ToggleVariables | Task): Promise<Task> {
  if (isToggleVariables(variables)) {
    return taskRepository.updateStatus(variables.task.id, variables.status, {
      on: variables.on,
      confidence: variables.confidence,
    });
  }
  return taskRepository.updateStatus(variables.id, nextStatusOnToggle(variables));
}

/** A rating of 1 means it did not come back: the work counts as failed, and the topic returns soon. */
export const statusForRating = (confidence: number): TaskStatus => (confidence <= 1 ? 'failed' : 'completed');

/**
 * Optimistically flips a task on the Mission list, rolls back on failure and
 * reconciles with the server afterwards. Finishing work also moves its topic's
 * review schedule (server-side), so topic views are refreshed too.
 */
export function useToggleTaskStatus(today: IsoDate) {
  const queryClient = useQueryClient();
  const key = taskKeys.mission(today);

  const mutation = useMutation<Task, Error, ToggleVariables, ToggleContext>({
    mutationKey: taskMutationKeys.toggle,
    mutationFn: runToggle,
    onMutate: async ({ task, status }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Task[]>(key);
      queryClient.setQueryData<Task[]>(key, (tasks) => tasks?.map((t) => (t.id === task.id ? withStatus(t, status) : t)));
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      showToast(`${describeError(error).title} — değişiklik geri alındı.`, 'danger');
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<Task[]>(key, (tasks) => tasks?.map((t) => (t.id === updated.id ? updated : t)));
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: taskKeys.all }),
        queryClient.invalidateQueries({ queryKey: topicKeys.all }),
        queryClient.invalidateQueries({ queryKey: reviewKeys.all }),
      ]),
  });

  // Finishing a review task asks how it went: that answer is the "son güven"
  // the topic shows, and a 1 sends the topic back tomorrow.
  const [rating, setRating] = useState<Task | null>(null);
  const { mutate } = mutation;

  const toggle = useCallback(
    (task: Task) => {
      if (task.status !== 'completed' && isReviewTask(task)) {
        setRating(task);
        return;
      }
      mutate({ task, status: nextStatusOnToggle(task), on: todayLocal(), confidence: null });
    },
    [mutate],
  );

  return {
    toggle,
    pendingTaskId: mutation.isPending ? (mutation.variables?.task.id ?? null) : null,
    /** State for the rating sheet; render it with ConfidenceSheet. */
    rating: {
      visible: rating !== null,
      title: 'Tekrar nasıl geçti?',
      subtitle: rating ? `${rating.topic.title} · ${rating.title}` : null,
      onSelect: (confidence: number) => {
        if (rating) mutate({ task: rating, status: statusForRating(confidence), on: todayLocal(), confidence });
        setRating(null);
      },
      /** Finish it without a rating: counted as a plain pass. */
      onSkip: () => {
        if (rating) mutate({ task: rating, status: 'completed', on: todayLocal(), confidence: null });
        setRating(null);
      },
      onDismiss: () => setRating(null),
    },
  };
}
