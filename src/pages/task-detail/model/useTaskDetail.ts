import {
  isDeadlineWork,
  isHomework,
  TASK_GROUP_LABEL,
  TASK_STATUS_LABEL,
  TASK_TYPE_LABEL,
  useTask,
} from '@entities/task';
import { useTaskNotes } from '@entities/task-note';
import { useTopic } from '@entities/topic';
import { useTopicMistakes } from '@entities/topic-mistake';
import { useMistakeActions } from '@features/mistake-book';
import { useNoteForm } from '@features/task-note-add';
import { useTaskTimer } from '@features/task-timer';
import { formatLongDate, formatRelativeDay, formatShortDate, localDateOf, todayLocal } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { useRouter } from 'expo-router';

export function useTaskDetail(taskId: string) {
  const taskQuery = useTask(taskId);
  const notesQuery = useTaskNotes(taskId);
  const task = taskQuery.data ?? null;
  // What went wrong on this topic before — read it before starting, not after.
  const mistakesQuery = useTopicMistakes(task?.topic.id ?? null);
  const mistakeActions = useMistakeActions();
  const router = useRouter();
  // Where the topic stands on the review schedule, one line under the title.
  const topicQuery = useTopic(task?.topic.id ?? null);
  const topic = task && topicQuery.data?.id === task.topic.id ? topicQuery.data : null;
  const today = todayLocal();

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
          completedLabel: task.completedAt ? formatLongDate(localDateOf(task.completedAt)) : null,
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
    timer: useTaskTimer(task),
    noteForm: useNoteForm(taskId),
    notes: notesQuery.data ?? [],
    notesLoading: notesQuery.isPending,
    mistakes: mistakesQuery.data ?? [],
    onResolveMistake: mistakeActions.resolve,
    resolvingMistakeId: mistakeActions.busyId,
    review: task
      ? {
          label:
            topic === null
              ? 'Konunun tekrar durumu'
              : topic.nextReviewOn === null
                ? 'Konu henüz tekrar takviminde değil'
                : topic.nextReviewOn <= today
                  ? 'Konunun tekrar zamanı geldi'
                  : `Konunun sıradaki tekrarı ${formatShortDate(topic.nextReviewOn)} (${formatRelativeDay(topic.nextReviewOn, today)})`,
          isDue: topic !== null && topic.nextReviewOn !== null && topic.nextReviewOn <= today,
          onOpen: () => router.push(`/topic/${task.topic.id}`),
        }
      : null,
  };
}
