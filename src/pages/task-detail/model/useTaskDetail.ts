import {
  isDeadlineWork,
  isHomework,
  TASK_GROUP_LABEL,
  TASK_STATUS_LABEL,
  TASK_TYPE_LABEL,
  useTask,
} from '@entities/task';
import { useTaskNotes } from '@entities/task-note';
import { useResolveMistake, useTopicMistakes } from '@entities/topic-mistake';
import { useNoteForm } from '@features/task-note-add';
import { useTaskTimer } from '@features/task-timer';
import { formatLongDate, todayLocal } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';

export function useTaskDetail(taskId: string) {
  const taskQuery = useTask(taskId);
  const notesQuery = useTaskNotes(taskId);
  const task = taskQuery.data ?? null;
  // What went wrong on this topic before — read it before starting, not after.
  const mistakesQuery = useTopicMistakes(task?.topic.id ?? null);
  const resolveMistake = useResolveMistake();

  return {
    isLoading: taskQuery.isPending && task === null,
    error: task === null && taskQuery.isError ? describeError(taskQuery.error) : null,
    retry: () => void taskQuery.refetch(),
    task,
    header: task
      ? {
          course: task.course.code ?? task.course.name,
          topic: task.topic.title,
          // Same label the card and the filter chip use.
          typeLabel: isHomework(task) ? TASK_GROUP_LABEL.homework : TASK_TYPE_LABEL[task.type],
          statusLabel: TASK_STATUS_LABEL[task.status],
          completedLabel: task.completedAt ? formatLongDate(task.completedAt.slice(0, 10)) : null,
          accuracyLabel:
            task.correctCount !== null && task.completedCount > 0
              ? `${task.correctCount}/${task.completedCount} doğru (%${Math.round(
                  (task.correctCount / task.completedCount) * 100,
                )})`
              : null,
        }
      : null,
    // Only homework with days still ahead of it has anything to distribute.
    showsAllocation: task !== null && isDeadlineWork(task, todayLocal()),
    timer: useTaskTimer(taskId, task?.estimatedMinutes ?? null),
    noteForm: useNoteForm(taskId),
    notes: notesQuery.data ?? [],
    notesLoading: notesQuery.isPending,
    mistakes: mistakesQuery.data ?? [],
    onResolveMistake: (mistakeId: string) => resolveMistake.mutate(mistakeId),
    resolvingMistakeId: resolveMistake.isPending ? (resolveMistake.variables ?? null) : null,
  };
}
