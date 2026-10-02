import type { IsoDate } from '@contracts/enums.contract';
import { localDateOf } from '@shared/lib/date';

/**
 * Where a stretch of study time was measured: Tekrar's own stopwatch on a
 * task, or the Focus Timer app on a course (and maybe a topic).
 */
export type StudySource = 'task' | 'timer';

/** One closed stretch of study time, whichever clock measured it. */
export interface StudyEntry {
  id: string;
  source: StudySource;
  startedAt: string;
  minutes: number;
  courseId: string;
  courseLabel: string;
  /** Null for timer time filed under the course alone. */
  topicId: string | null;
  topicTitle: string | null;
  /** The task it was measured on; null for timer time filed under a topic or course. */
  taskId: string | null;
}

export interface TopicStudyRow {
  /** Null gathers the course's time that has no topic. */
  topicId: string | null;
  title: string;
  minutes: number;
  sessions: number;
  lastStudiedOn: IsoDate;
}

export interface CourseStudyRow {
  courseId: string;
  label: string;
  minutes: number;
  /** Where the course's time went, most first. */
  topics: TopicStudyRow[];
}

/** What a course's time without a topic is called on screen. */
export const NO_TOPIC_LABEL = 'Konu seçilmeden';

export const totalMinutes = (entries: readonly StudyEntry[]): number =>
  entries.reduce((sum, entry) => sum + entry.minutes, 0);

export function entriesBetween(entries: readonly StudyEntry[], from: IsoDate, to: IsoDate): StudyEntry[] {
  return entries.filter((entry) => {
    const day = localDateOf(entry.startedAt);
    return day >= from && day <= to;
  });
}

/** Time per topic, most first; time without a topic comes last whatever its size. */
export function summarizeByTopic(entries: readonly StudyEntry[]): TopicStudyRow[] {
  const rows = new Map<string | null, TopicStudyRow>();
  for (const entry of entries) {
    const day = localDateOf(entry.startedAt);
    const row = rows.get(entry.topicId);
    if (row) {
      row.minutes += entry.minutes;
      row.sessions += 1;
      if (day > row.lastStudiedOn) row.lastStudiedOn = day;
    } else {
      rows.set(entry.topicId, {
        topicId: entry.topicId,
        title: entry.topicTitle ?? NO_TOPIC_LABEL,
        minutes: entry.minutes,
        sessions: 1,
        lastStudiedOn: day,
      });
    }
  }
  return [...rows.values()].sort(
    (a, b) => Number(a.topicId === null) - Number(b.topicId === null) || b.minutes - a.minutes,
  );
}

/** Time per course, most first, each with its topics. */
export function summarizeByCourse(entries: readonly StudyEntry[]): CourseStudyRow[] {
  const byCourse = new Map<string, StudyEntry[]>();
  for (const entry of entries) {
    const list = byCourse.get(entry.courseId);
    if (list) list.push(entry);
    else byCourse.set(entry.courseId, [entry]);
  }
  return [...byCourse.entries()]
    .map(([courseId, list]) => ({
      courseId,
      label: list[0]?.courseLabel ?? '',
      minutes: totalMinutes(list),
      topics: summarizeByTopic(list),
    }))
    .sort((a, b) => b.minutes - a.minutes);
}
