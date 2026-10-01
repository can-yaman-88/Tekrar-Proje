import type { IsoDate } from '@contracts/enums.contract';
import {
  accuracyLabel,
  latestReviewByTopic,
  memoryOf,
  useRecentReviews,
  useReviewRadar,
  type MemoryState,
  type RadarTopic,
  type ReviewDigest,
} from '@entities/topic';
import { mistakeChip, useMistakeBook, type TopicMistakeWithContext } from '@entities/topic-mistake';
import { useMistakeActions, type MistakeEntryModel } from '@features/mistake-book';
import { useReminders } from '@features/reminders';
import {
  addDays,
  diffInDays,
  formatRelativeDay,
  formatShortDate,
  localDateOf,
  useToday,
} from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

export type NotebookTab = 'reviews' | 'mistakes';
export type BookFilter = 'open' | 'resolved' | 'all';

export interface ReviewRow {
  id: string;
  title: string;
  courseLabel: string;
  /** "2 gün gecikti", "bugün", "3 Eki · 2 gün sonra" */
  dueLabel: string;
  isLate: boolean;
  /** "Son çalışma 27 Eyl (4 gün önce) · güven 4/5 · 8/10 doğru" */
  lastLabel: string;
  /** "6 günlük aralık · 2. tekrar" */
  scheduleLabel: string;
  memory: MemoryState;
  /** Share of the gap already gone, for the little bar. */
  elapsed: number;
}

export interface ReviewSection {
  key: 'late' | 'today' | 'week' | 'later';
  title: string;
  rows: ReviewRow[];
}

export interface MistakeGroup {
  topicId: string;
  courseLabel: string;
  topicTitle: string;
  /** "2 açık · 1 çözüldü · son 28 Eyl" */
  summary: string;
  entries: MistakeEntryModel[];
}

/** How far ahead the notebook lists reviews; the radar shows the rest. */
const HORIZON_DAYS = 14;
/** Far enough back to know each topic's last review. */
const HISTORY_DAYS = 180;

function lastReviewLabel(topic: RadarTopic, last: ReviewDigest | undefined, today: IsoDate): string {
  const day = last?.reviewedOn ?? (topic.lastReviewedAt ? localDateOf(topic.lastReviewedAt) : null);
  if (day === null) return 'Henüz çalışılmadı';
  const parts = [`Son çalışma ${formatShortDate(day)} (${formatRelativeDay(day, today)})`];
  if (last?.confidence) parts.push(`güven ${last.confidence}/5`);
  const accuracy = last ? accuracyLabel(last) : null;
  if (accuracy) parts.push(accuracy);
  return parts.join(' · ');
}

function dueLabel(nextReviewOn: IsoDate, today: IsoDate): string {
  const days = diffInDays(today, nextReviewOn);
  if (days < 0) return `${-days} gün gecikti`;
  if (days === 0) return 'bugün';
  if (days === 1) return 'yarın';
  return `${formatShortDate(nextReviewOn)} · ${days} gün sonra`;
}

function entryModel(entry: TopicMistakeWithContext): MistakeEntryModel {
  const source = entry.fromCheckin ? 'değerlendirmeden' : 'elle eklendi';
  return {
    id: entry.id,
    body: entry.body,
    concept: entry.concept,
    chip: mistakeChip(entry),
    meta: [formatShortDate(localDateOf(entry.createdAt)), source, entry.taskTitle].filter(Boolean).join(' · '),
    isResolved: entry.resolvedAt !== null,
    resolvedLabel: entry.resolvedAt ? `çözüldü: ${formatShortDate(localDateOf(entry.resolvedAt))}` : null,
  };
}

const normalize = (text: string) => text.toLocaleLowerCase('tr').trim();

/**
 * The notebook: what is due for review, and everything the student has got
 * wrong. Two tabs, because the two questions are asked together but read
 * differently — "neyi tekrar etmeliyim" is a schedule, "nerede takılıyordum"
 * is a list to work through.
 */
export function useNotebookScreen() {
  const today = useToday();
  const router = useRouter();
  const [tab, setTab] = useState<NotebookTab>('reviews');
  const [filter, setFilter] = useState<BookFilter>('open');
  const [search, setSearch] = useState('');
  const [course, setCourse] = useState<string | null>(null);
  const [addingTopicId, setAddingTopicId] = useState<string | null>(null);
  const [isRefreshing, setRefreshing] = useState(false);

  // The whole book, resolved included: the counts on both filters stay right.
  const book = useMistakeBook(true);
  const radar = useReviewRadar();
  const recent = useRecentReviews(useMemo(() => addDays(today, -HISTORY_DAYS), [today]));
  const actions = useMistakeActions();
  const reminders = useReminders();

  // --- Reviews -------------------------------------------------------------
  const reviewSections = useMemo<ReviewSection[]>(() => {
    const latest = latestReviewByTopic(recent.data ?? []);
    const horizon = addDays(today, HORIZON_DAYS);
    const weekEnd = addDays(today, 7);
    const rows = (radar.data ?? [])
      .filter((topic) => topic.nextReviewOn !== null && topic.nextReviewOn <= horizon)
      .sort((a, b) => (a.nextReviewOn ?? '').localeCompare(b.nextReviewOn ?? '') || a.easeFactor - b.easeFactor)
      .map((topic) => {
        const next = topic.nextReviewOn as IsoDate;
        const memory = memoryOf(topic, today);
        return {
          row: {
            id: topic.id,
            title: topic.title,
            courseLabel: topic.courseLabel,
            dueLabel: dueLabel(next, today),
            isLate: next < today,
            lastLabel: lastReviewLabel(topic, latest.get(topic.id), today),
            scheduleLabel:
              topic.repetitions === 0
                ? `${Math.max(1, topic.intervalDays)} günlük aralık · yeniden başlıyor`
                : `${topic.intervalDays} günlük aralık · ${topic.repetitions}. başarılı tekrar`,
            memory: memory.state,
            elapsed: memory.elapsed,
          },
          next,
        };
      });

    const sections: ReviewSection[] = [
      { key: 'late', title: 'Geciken', rows: rows.filter((r) => r.next < today).map((r) => r.row) },
      { key: 'today', title: 'Bugün', rows: rows.filter((r) => r.next === today).map((r) => r.row) },
      {
        key: 'week',
        title: 'Bu hafta',
        rows: rows.filter((r) => r.next > today && r.next <= weekEnd).map((r) => r.row),
      },
      { key: 'later', title: 'Sonraki hafta', rows: rows.filter((r) => r.next > weekEnd).map((r) => r.row) },
    ];
    return sections.filter((section) => section.rows.length > 0);
  }, [radar.data, recent.data, today]);

  const reviewCounts = useMemo(() => {
    const count = (key: ReviewSection['key']) => reviewSections.find((s) => s.key === key)?.rows.length ?? 0;
    return { late: count('late'), today: count('today'), week: count('week') };
  }, [reviewSections]);

  const studiedTopics = (radar.data ?? []).filter((topic) => topic.nextReviewOn !== null).length;

  // --- Mistakes ------------------------------------------------------------
  const all = useMemo(() => book.data ?? [], [book.data]);
  const openCount = all.filter((entry) => entry.resolvedAt === null).length;
  const resolvedCount = all.length - openCount;

  const courses = useMemo(
    () => [...new Set(all.map((entry) => entry.courseLabel))].sort((a, b) => a.localeCompare(b, 'tr')),
    [all],
  );

  const groups = useMemo<MistakeGroup[]>(() => {
    const query = normalize(search);
    const visible = all.filter((entry) => {
      if (filter === 'open' && entry.resolvedAt !== null) return false;
      if (filter === 'resolved' && entry.resolvedAt === null) return false;
      if (course !== null && entry.courseLabel !== course) return false;
      if (query === '') return true;
      return [entry.body, entry.concept ?? '', entry.topicTitle, entry.courseLabel, entry.taskTitle ?? ''].some(
        (field) => normalize(field).includes(query),
      );
    });

    const byTopic = new Map<string, { group: MistakeGroup; latest: string; open: number; resolved: number }>();
    for (const entry of visible) {
      const current = byTopic.get(entry.topicId) ?? {
        group: {
          topicId: entry.topicId,
          courseLabel: entry.courseLabel,
          topicTitle: entry.topicTitle,
          summary: '',
          entries: [],
        },
        latest: entry.createdAt,
        open: 0,
        resolved: 0,
      };
      current.group.entries.push(entryModel(entry));
      if (entry.createdAt > current.latest) current.latest = entry.createdAt;
      if (entry.resolvedAt === null) current.open++;
      else current.resolved++;
      byTopic.set(entry.topicId, current);
    }

    // Most recent trouble first: that is where the student is right now.
    return [...byTopic.values()]
      .sort((a, b) => b.latest.localeCompare(a.latest))
      .map(({ group, latest, open, resolved }) => ({
        ...group,
        // Open entries first inside a topic, each half newest first.
        entries: [...group.entries].sort((a, b) => Number(a.isResolved) - Number(b.isResolved)),
        summary: [
          open > 0 ? `${open} açık` : null,
          resolved > 0 ? `${resolved} çözüldü` : null,
          `son ${formatShortDate(localDateOf(latest))}`,
        ]
          .filter(Boolean)
          .join(' · '),
      }));
  }, [all, course, filter, search]);

  // --- Shared --------------------------------------------------------------
  const queries = [book, radar];
  const failed = queries.find((query) => query.isError && query.data === undefined);
  const { refetch: refetchBook } = book;
  const { refetch: refetchRadar } = radar;
  const { refetch: refetchRecent } = recent;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetchBook(), refetchRadar(), refetchRecent()]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchBook, refetchRadar, refetchRecent]);

  return {
    isLoading: queries.some((query) => query.isPending && query.data === undefined),
    error: failed ? describeError(failed.error) : null,
    retry: () => void refresh(),
    isRefreshing,
    refresh,
    tab,
    onTab: setTab,
    reviews: {
      sections: reviewSections,
      counts: reviewCounts,
      studiedTopics,
      onOpenTopic: (topicId: string) => router.push(`/topic/${topicId}`),
      onOpenRadar: () => router.push('/review-radar'),
      // Nothing about reviews reaches the student unless they let it.
      notificationPrompt: reminders.reviewsEnabled
        ? null
        : {
            busy: reminders.isBusy,
            onEnable: () => reminders.setReviewsEnabled(true),
          },
    },
    mistakes: {
      groups,
      openCount,
      resolvedCount,
      filter,
      onFilter: setFilter,
      search,
      onSearch: setSearch,
      courses,
      course,
      onCourse: (label: string | null) => setCourse((current) => (current === label ? null : label)),
      actions,
      addingTopicId,
      onStartAdding: (topicId: string) => setAddingTopicId(topicId),
      onStopAdding: () => setAddingTopicId(null),
      onOpenTopic: (topicId: string) => router.push(`/topic/${topicId}`),
      isFiltered: search.trim() !== '' || course !== null,
      onClearFilters: () => {
        setSearch('');
        setCourse(null);
      },
    },
    onOpenProgress: () => router.push('/progress'),
  };
}

export type NotebookController = ReturnType<typeof useNotebookScreen>;
