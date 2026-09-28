import { useCourseProgress } from '@entities/topic';
import { buildCourseProgress, type Verdict } from '@domain/progress';
import { formatShortDate, useToday } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { useCallback, useMemo, useState } from 'react';

export interface ProgressRow {
  id: string;
  courseLabel: string;
  coverage: number;
  coverageLabel: string;
  accuracyLabel: string | null;
  examLabel: string | null;
  verdict: Verdict;
  message: string;
}

const VERDICT_TONE: Record<Verdict, 'success' | 'default' | 'warning' | 'danger' | 'muted'> = {
  ahead: 'success',
  on_track: 'success',
  behind: 'danger',
  unknown: 'muted',
  no_exam: 'muted',
};

/** Where each course stands against the exam that is coming for it. */
export function useProgressScreen() {
  const today = useToday();
  const query = useCourseProgress(today);
  const [isRefreshing, setRefreshing] = useState(false);

  const rows = useMemo<ProgressRow[]>(
    () =>
      (query.data ?? [])
        .map((course) => buildCourseProgress(course, today))
        .map((progress) => ({
          id: progress.courseId,
          courseLabel: progress.courseLabel,
          coverage: progress.coverage,
          coverageLabel: `${progress.finishedTopics}/${progress.totalTopics} konu hazır${
            progress.startedTopics > 0 ? ` · ${progress.startedTopics} yarım` : ''
          }`,
          accuracyLabel: progress.accuracyPercent === null ? null : `isabet %${progress.accuracyPercent}`,
          examLabel:
            progress.exam === null
              ? null
              : `${progress.exam.title} · ${formatShortDate(progress.exam.date)} · ${progress.exam.topicsReady}/${
                  progress.exam.topicsInScope
                } hazır`,
          verdict: progress.verdict,
          message: progress.message,
        }))
        // The course in trouble goes to the top: that is what the screen is for.
        .sort((a, b) => verdictRank(a.verdict) - verdictRank(b.verdict) || a.courseLabel.localeCompare(b.courseLabel, 'tr')),
    [query.data, today],
  );

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
    retry: () => void refresh(),
    isRefreshing,
    refresh,
    rows,
    toneOf: (verdict: Verdict) => VERDICT_TONE[verdict],
  };
}

const verdictRank = (verdict: Verdict): number =>
  verdict === 'behind' ? 0 : verdict === 'unknown' ? 1 : verdict === 'on_track' ? 2 : verdict === 'ahead' ? 3 : 4;

export type ProgressController = ReturnType<typeof useProgressScreen>;
