import { isReviewDue, useReviewRadar } from '@entities/topic';
import { mistakeLabel, useMistakeBook, useResolveMistake, type TopicMistakeWithContext } from '@entities/topic-mistake';
import { addDays, formatShortDate, useToday } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

export type BookFilter = 'open' | 'resolved' | 'all';

export interface MistakeRow {
  id: string;
  label: string;
  isResolved: boolean;
}

export interface MistakeGroup {
  key: string;
  courseLabel: string;
  topicTitle: string;
  topicId: string;
  rows: MistakeRow[];
}

export interface ReviewRow {
  id: string;
  title: string;
  courseLabel: string;
  dueLabel: string;
  isDue: boolean;
}

/** How far ahead a review still counts as "coming up". */
const SOON_DAYS = 3;

/**
 * The notebook: what is due for review, and everything the student has got
 * wrong. One screen, because these two questions are always asked together —
 * "neyi tekrar etmeliyim" and "nerede takılıyordum".
 */
export function useNotebookScreen() {
  const today = useToday();
  const router = useRouter();
  const [filter, setFilter] = useState<BookFilter>('open');
  const [isRefreshing, setRefreshing] = useState(false);

  const book = useMistakeBook(filter !== 'open');
  const radar = useReviewRadar();
  const resolve = useResolveMistake();

  const visible = useMemo(() => {
    const all = book.data ?? [];
    if (filter === 'open') return all.filter((entry) => entry.resolvedAt === null);
    if (filter === 'resolved') return all.filter((entry) => entry.resolvedAt !== null);
    return all;
  }, [book.data, filter]);

  // Grouped the way the student thinks about them: course, then topic.
  const groups = useMemo<MistakeGroup[]>(() => {
    const byTopic = new Map<string, MistakeGroup>();
    for (const entry of visible as TopicMistakeWithContext[]) {
      const group = byTopic.get(entry.topicId) ?? {
        key: entry.topicId,
        topicId: entry.topicId,
        courseLabel: entry.courseLabel,
        topicTitle: entry.topicTitle,
        rows: [],
      };
      group.rows.push({ id: entry.id, label: mistakeLabel(entry), isResolved: entry.resolvedAt !== null });
      byTopic.set(entry.topicId, group);
    }
    return [...byTopic.values()].sort(
      (a, b) => a.courseLabel.localeCompare(b.courseLabel, 'tr') || a.topicTitle.localeCompare(b.topicTitle, 'tr'),
    );
  }, [visible]);

  const reviews = useMemo<ReviewRow[]>(() => {
    const soon = addDays(today, SOON_DAYS);
    return (radar.data ?? [])
      .filter((topic) => topic.nextReviewOn !== null && topic.nextReviewOn <= soon)
      .sort((a, b) => (a.nextReviewOn ?? '').localeCompare(b.nextReviewOn ?? ''))
      .map((topic) => ({
        id: topic.id,
        title: topic.title,
        courseLabel: topic.courseLabel,
        dueLabel:
          topic.nextReviewOn === today
            ? 'bugün'
            : topic.nextReviewOn === addDays(today, 1)
              ? 'yarın'
              : formatShortDate(topic.nextReviewOn ?? today),
        isDue: isReviewDue(topic, today),
      }));
  }, [radar.data, today]);

  const queries = [book, radar];
  const failed = queries.find((query) => query.isError);
  const { refetch: refetchBook } = book;
  const { refetch: refetchRadar } = radar;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetchBook(), refetchRadar()]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchBook, refetchRadar]);

  return {
    isLoading: queries.some((query) => query.isPending && query.data === undefined),
    error: failed ? describeError(failed.error) : null,
    retry: () => void refresh(),
    isRefreshing,
    refresh,
    filter,
    onFilter: setFilter,
    groups,
    openCount: (book.data ?? []).filter((entry) => entry.resolvedAt === null).length,
    reviews,
    onResolve: (mistakeId: string) => resolve.mutate(mistakeId),
    resolvingId: resolve.isPending ? (resolve.variables ?? null) : null,
    onOpenRadar: () => router.push('/review-radar'),
    onOpenProgress: () => router.push('/progress'),
  };
}

export type NotebookController = ReturnType<typeof useNotebookScreen>;
