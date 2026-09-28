import {
  isWeak,
  MASTERY_LABEL,
  masteryOf,
  useReviewRadar,
  type RadarTopic,
  type TopicRowModel,
} from '@entities/topic';
import { diffInDays, formatShortDate, useToday } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { useCallback, useMemo, useState } from 'react';

export interface RadarSection {
  key: 'due' | 'soon' | 'weak' | 'untouched';
  title: string;
  hint: string;
  data: TopicRowModel[];
}

const toRowModel = (topic: RadarTopic, today: string): TopicRowModel => {
  const mastery = masteryOf(topic);
  const review =
    topic.nextReviewOn === null
      ? null
      : topic.nextReviewOn <= today
        ? 'Tekrar zamanı geldi'
        : `${formatShortDate(topic.nextReviewOn)} · ${diffInDays(today, topic.nextReviewOn)} gün`;

  return {
    id: topic.id,
    title: `${topic.courseLabel} · ${topic.title}`,
    weekLabel: topic.weekNumber === null ? null : `${topic.weekNumber}. hafta`,
    mastery,
    masteryLabel: MASTERY_LABEL[mastery],
    reviewLabel: review,
    statsLabel: topic.solvedProblems > 0 ? `${topic.solvedProblems} problem` : null,
    hasAdvancedMaterial: topic.hasAdvancedMaterial,
  };
};

/** What is fading: due reviews first, then what is coming, then the weak spots. */
export function useReviewRadarScreen() {
  const today = useToday();
  const query = useReviewRadar();
  const [isRefreshing, setRefreshing] = useState(false);

  const topics = useMemo(() => query.data ?? [], [query.data]);

  const sections = useMemo<RadarSection[]>(() => {
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
      .map((section) => ({ ...section, data: section.data.map((topic) => toRowModel(topic, today)) }));
  }, [topics, today]);

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
  };
}
