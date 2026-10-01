import {
  accuracyLabel,
  isWeak,
  latestReviewByTopic,
  MASTERY_LABEL,
  masteryOf,
  useRecentReviews,
  useReviewRadar,
  type RadarTopic,
  type ReviewDigest,
  type TopicRowModel,
} from '@entities/topic';
import { addDays, diffInDays, formatRelativeDay, formatShortDate, localDateOf, useToday } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

export interface RadarSection {
  key: 'due' | 'soon' | 'weak' | 'untouched';
  title: string;
  hint: string;
  data: TopicRowModel[];
}

const toRowModel = (topic: RadarTopic, today: string, last: ReviewDigest | undefined): TopicRowModel => {
  const mastery = masteryOf(topic);
  const review =
    topic.nextReviewOn === null
      ? null
      : topic.nextReviewOn < today
        ? `Tekrar ${diffInDays(topic.nextReviewOn, today)} gün gecikti`
        : topic.nextReviewOn === today
          ? 'Tekrar zamanı bugün'
          : `Sıradaki tekrar ${formatShortDate(topic.nextReviewOn)} · ${diffInDays(today, topic.nextReviewOn)} gün`;
  const lastDay = last?.reviewedOn ?? (topic.lastReviewedAt ? localDateOf(topic.lastReviewedAt) : null);
  const lastReview =
    lastDay === null
      ? null
      : [
          `Son çalışma ${formatRelativeDay(lastDay, today)}`,
          last?.confidence ? `güven ${last.confidence}/5` : null,
          last ? accuracyLabel(last) : null,
        ]
          .filter(Boolean)
          .join(' · ');

  return {
    id: topic.id,
    title: `${topic.courseLabel} · ${topic.title}`,
    weekLabel: topic.weekNumber === null ? null : `${topic.weekNumber}. hafta`,
    mastery,
    masteryLabel: MASTERY_LABEL[mastery],
    reviewLabel: review,
    reviewIsDue: topic.nextReviewOn !== null && topic.nextReviewOn <= today,
    lastReviewLabel: lastReview,
    statsLabel: topic.solvedProblems > 0 ? `${topic.solvedProblems} problem` : null,
    hasAdvancedMaterial: topic.hasAdvancedMaterial,
  };
};

/** What is fading: due reviews first, then what is coming, then the weak spots. */
export function useReviewRadarScreen() {
  const today = useToday();
  const router = useRouter();
  const query = useReviewRadar();
  const recent = useRecentReviews(useMemo(() => addDays(today, -180), [today]));
  const [isRefreshing, setRefreshing] = useState(false);

  const topics = useMemo(() => query.data ?? [], [query.data]);

  const sections = useMemo<RadarSection[]>(() => {
    const latest = latestReviewByTopic(recent.data ?? []);
    const due = topics.filter((t) => t.nextReviewOn !== null && t.nextReviewOn <= today);
    const soon = topics.filter(
      (t) => t.nextReviewOn !== null && t.nextReviewOn > today && diffInDays(today, t.nextReviewOn) <= 7,
    );
    const dueIds = new Set([...due, ...soon].map((t) => t.id));
    const weak = topics.filter((t) => isWeak(t) && !dueIds.has(t.id));
    const untouched = topics.filter((t) => t.nextReviewOn === null && t.lastReviewedAt === null && !isWeak(t));

    return [
      {
        key: 'due' as const,
        title: 'Tekrar zamanı gelenler',
        hint: 'Aralıklı tekrar takvimine göre şimdi bakılması gerekenler.',
        data: due,
      },
      {
        key: 'soon' as const,
        title: 'Bu hafta sırada',
        hint: 'Önümüzdeki yedi günde tekrar zamanı gelecek konular.',
        data: soon,
      },
      {
        key: 'weak' as const,
        title: 'Zayıflayanlar',
        hint: 'Takıldığın ya da tekrar aralığı kısalan konular; plan bunlara öncelik verir.',
        data: weak,
      },
      {
        key: 'untouched' as const,
        title: 'Hiç çalışılmamışlar',
        hint: 'Döngüye henüz girmemiş konular.',
        data: untouched,
      },
    ]
      .filter((section) => section.data.length > 0)
      .map((section) => ({
        ...section,
        data: section.data.map((topic) => toRowModel(topic, today, latest.get(topic.id))),
      }));
  }, [recent.data, topics, today]);

  const { refetch } = query;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  return {
    isLoading: query.isPending && query.data === undefined,
    error: query.data === undefined && query.isError ? describeError(query.error) : null,
    sections,
    dueCount: sections.find((s) => s.key === 'due')?.data.length ?? 0,
    isRefreshing,
    refresh,
    onOpenTopic: (topicId: string) => router.push(`/topic/${topicId}`),
  };
}
