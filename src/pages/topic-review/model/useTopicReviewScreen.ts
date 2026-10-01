import { isOpen, TASK_STATUS_LABEL, TASK_TYPE_LABEL, useTopicTasks, type Task } from '@entities/task';
import {
  accuracyLabel,
  CONFIDENCE_LABEL,
  MASTERY_LABEL,
  masteryOf,
  memoryOf,
  qualityLabel,
  REVIEW_SOURCE_LABEL,
  useTopic,
  useTopicReviews,
  type MasteryLevel,
  type MemoryState,
  type ReviewEvent,
  type ReviewTone,
} from '@entities/topic';
import { mistakeChip, useTopicMistakeHistory, type TopicMistake } from '@entities/topic-mistake';
import { useMistakeActions, type MistakeEntryModel } from '@features/mistake-book';
import { useLogReview } from '@features/review-cycle';
import { formatLongDate, formatRelativeDay, formatShortDate, localDateOf, useToday } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

export interface HistoryRow {
  id: string;
  dateLabel: string;
  sourceLabel: string;
  verdict: string;
  tone: ReviewTone;
  /** "güven 4/5 · 8/10 doğru · Kafes — sınav" */
  detail: string | null;
  /** "aralık 1 → 6 gün · sıradaki 7 Eki" */
  change: string;
}

export interface TopicTaskRow {
  id: string;
  title: string;
  /** "Feynman · 3 Eki" or "Tamamlandı · 28 Eyl · güven 4/5" */
  meta: string;
  isDone: boolean;
  isLate: boolean;
}

const confidenceText = (confidence: number) =>
  `${confidence}/5 · ${CONFIDENCE_LABEL[confidence as 1 | 2 | 3 | 4 | 5] ?? ''}`.trim();

function historyRow(event: ReviewEvent): HistoryRow {
  const verdict = qualityLabel(event.quality);
  const detail = [
    event.confidence ? `güven ${event.confidence}/5` : null,
    accuracyLabel(event),
    event.taskTitle,
  ]
    .filter(Boolean)
    .join(' · ');
  const change = event.wasEarly
    ? `erken tekrar: aralık ${event.intervalAfter} gün olarak korundu`
    : event.quality < 3
      ? `aralık sıfırlandı → ${event.intervalAfter} gün`
      : `aralık ${event.intervalBefore} → ${event.intervalAfter} gün`;
  return {
    id: event.id,
    dateLabel: formatShortDate(event.reviewedOn),
    sourceLabel: REVIEW_SOURCE_LABEL[event.source],
    verdict: verdict.label,
    tone: verdict.tone,
    detail: detail === '' ? null : detail,
    change: event.nextReviewOn ? `${change} · sıradaki ${formatShortDate(event.nextReviewOn)}` : change,
  };
}

function taskRow(task: Task, today: string): TopicTaskRow {
  if (isOpen(task)) {
    return {
      id: task.id,
      title: task.title,
      meta: `${TASK_TYPE_LABEL[task.type]} · ${formatShortDate(task.dueDate)} (${formatRelativeDay(task.dueDate, today)})`,
      isDone: false,
      isLate: task.dueDate < today,
    };
  }
  const finishedOn = task.completedAt ? localDateOf(task.completedAt) : task.dueDate;
  return {
    id: task.id,
    title: task.title,
    meta: [
      TASK_STATUS_LABEL[task.status],
      formatShortDate(finishedOn),
      task.confidenceLevel ? `güven ${task.confidenceLevel}/5` : null,
      task.correctCount !== null && task.completedCount > 0 ? `${task.correctCount}/${task.completedCount} doğru` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    isDone: task.status === 'completed',
    isLate: false,
  };
}

function mistakeEntry(mistake: TopicMistake): MistakeEntryModel {
  return {
    id: mistake.id,
    body: mistake.body,
    concept: mistake.concept,
    chip: mistakeChip(mistake),
    meta: [formatShortDate(localDateOf(mistake.createdAt)), mistake.fromCheckin ? 'değerlendirmeden' : 'elle eklendi'].join(' · '),
    isResolved: mistake.resolvedAt !== null,
    resolvedLabel: mistake.resolvedAt ? `çözüldü: ${formatShortDate(localDateOf(mistake.resolvedAt))}` : null,
  };
}

/**
 * One topic, everything about its review cycle: when it was last studied,
 * when it comes back, how sure the student was, every review that moved the
 * schedule, what went wrong in it, and the work it has on the board.
 */
export function useTopicReviewScreen(topicId: string) {
  const today = useToday();
  const router = useRouter();
  const topicQuery = useTopic(topicId);
  const reviewsQuery = useTopicReviews(topicId);
  const tasksQuery = useTopicTasks(topicId);
  const mistakesQuery = useTopicMistakeHistory(topicId);
  const logReview = useLogReview();
  const mistakeActions = useMistakeActions();
  const [isRating, setRating] = useState(false);
  const [isAdding, setAdding] = useState(false);
  const [isRefreshing, setRefreshing] = useState(false);

  const topic = topicQuery.data ?? null;
  const events = useMemo(() => reviewsQuery.data ?? [], [reviewsQuery.data]);
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);

  const status = useMemo(() => {
    if (!topic) return null;
    const memory = memoryOf(topic, today);
    const latest = events[0];
    const lastDay = latest?.reviewedOn ?? (topic.lastReviewedAt ? localDateOf(topic.lastReviewedAt) : null);
    const lastConfidence = events.find((event) => event.confidence !== null)?.confidence ?? null;
    const lastAccuracy =
      events.map(accuracyLabel).find((label) => label !== null) ??
      (() => {
        const scored = tasks.find((task) => task.correctCount !== null && task.completedCount > 0);
        return scored ? `${scored.correctCount}/${scored.completedCount} doğru` : null;
      })();
    const mastery: MasteryLevel = masteryOf(topic);

    return {
      memory: memory.state as MemoryState,
      memoryLabel: memory.label,
      elapsed: memory.elapsed,
      mastery,
      masteryLabel: MASTERY_LABEL[mastery],
      nextLabel: topic.nextReviewOn
        ? `${formatLongDate(topic.nextReviewOn)} · ${formatRelativeDay(topic.nextReviewOn, today)}`
        : 'Henüz takvimde değil',
      isDue: topic.nextReviewOn !== null && topic.nextReviewOn <= today,
      lastLabel: lastDay ? `${formatLongDate(lastDay)} · ${formatRelativeDay(lastDay, today)}` : 'Henüz çalışılmadı',
      confidenceLabel: lastConfidence ? confidenceText(lastConfidence) : 'Puan verilmedi',
      accuracyLabel: lastAccuracy ?? 'Ölçülmedi',
      stats: [
        { label: 'Aralık', value: topic.nextReviewOn === null ? '—' : `${topic.intervalDays} gün` },
        { label: 'Başarılı tekrar', value: String(topic.repetitions) },
        { label: 'Kolaylık', value: topic.easeFactor.toFixed(2) },
      ],
    };
  }, [events, tasks, today, topic]);

  const openReviewTask = tasks.find((task) => isOpen(task) && task.source === 'spaced_repetition' && task.dueDate <= today);

  const { refetch: refetchTopic } = topicQuery;
  const { refetch: refetchReviews } = reviewsQuery;
  const { refetch: refetchTasks } = tasksQuery;
  const { refetch: refetchMistakes } = mistakesQuery;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetchTopic(), refetchReviews(), refetchTasks(), refetchMistakes()]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchMistakes, refetchReviews, refetchTasks, refetchTopic]);

  const { mutate: logMutate } = logReview;
  const mistakes = mistakesQuery.data ?? [];

  return {
    isLoading: topicQuery.isPending && topic === null,
    error: topic === null && topicQuery.isError ? describeError(topicQuery.error) : null,
    retry: () => void refresh(),
    isRefreshing,
    refresh,
    header: topic
      ? {
          title: topic.title,
          caption: [topic.courseName, topic.weekNumber === null ? null : `${topic.weekNumber}. hafta`]
            .filter(Boolean)
            .join(' · '),
        }
      : null,
    status,
    history: events.map(historyRow),
    openTasks: tasks.filter(isOpen).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((t) => taskRow(t, today)),
    doneTasks: tasks
      .filter((task) => task.status === 'completed' || task.status === 'failed')
      .slice(0, 8)
      .map((t) => taskRow(t, today)),
    mistakes: {
      entries: [...mistakes].sort((a, b) => Number(a.resolvedAt !== null) - Number(b.resolvedAt !== null)).map(mistakeEntry),
      openCount: mistakes.filter((mistake) => mistake.resolvedAt === null).length,
      actions: mistakeActions,
      isAdding,
      onStartAdding: () => setAdding(true),
      onStopAdding: () => setAdding(false),
    },
    review: {
      /** The board already has today's review for this topic: logging closes it too. */
      openTaskTitle: openReviewTask?.title ?? null,
      isSaving: logReview.isPending,
      onStart: () => setRating(true),
      sheet: {
        visible: isRating,
        title: 'Tekrar nasıl geçti?',
        subtitle: topic ? topic.title : null,
        busy: logReview.isPending,
        onSelect: (confidence: number) => {
          setRating(false);
          logMutate({ topicId, confidence });
        },
        onDismiss: () => setRating(false),
      },
    },
    onOpenTask: (taskId: string) => router.push(`/task/${taskId}`),
  };
}

export type TopicReviewController = ReturnType<typeof useTopicReviewScreen>;
