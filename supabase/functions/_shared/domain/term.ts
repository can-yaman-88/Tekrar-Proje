// Which teaching week a day falls in, and which topics have been taught by then.
//
// A syllabus lists topics by week; the study loop starts with "konu işlendikten
// sonra konsept sayfasına ekle". Planning week 9's topic in week 2 asks the
// student to write up a lecture they have not heard yet. The week number is
// only meaningful against the day week 1 started, which the syllabus may state
// or the student may set — and one semester usually starts on one day for
// every course, so a course without a date borrows the others'.
import type { IsoDate } from '../contracts/enums.contract.ts';

const MS_PER_DAY = 86_400_000;

const daysBetween = (from: IsoDate, to: IsoDate): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);

/** Monday of the week containing `date`. */
export function mondayOf(date: IsoDate): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  const weekday = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - ((weekday + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * 1 on the days of week 1, 2 the week after, and so on; 0 or less before the
 * term. Weeks run Monday to Sunday, counted from the Monday of the week the
 * term starts in — a term that starts on a Wednesday still has that week as 1.
 */
export function teachingWeekOf(termStart: IsoDate, date: IsoDate): number {
  return Math.floor(daysBetween(mondayOf(termStart), date) / 7) + 1;
}

/** The Monday of week 1, given that `today` falls in teaching week `week`. */
export function termStartFor(today: IsoDate, week: number): IsoDate {
  const monday = new Date(`${mondayOf(today)}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (Math.max(1, Math.round(week)) - 1) * 7);
  return monday.toISOString().slice(0, 10);
}

/**
 * Each course's term start: its own when the syllabus or the student gave one,
 * otherwise the date most of the student's other courses share (ties go to the
 * earliest). Null when no course has one — then week numbers say nothing.
 */
export function resolveTermStarts(
  courses: readonly { id: string; termStartDate: IsoDate | null }[],
): Record<string, IsoDate | null> {
  const counts = new Map<IsoDate, number>();
  for (const course of courses) {
    if (course.termStartDate) counts.set(course.termStartDate, (counts.get(course.termStartDate) ?? 0) + 1);
  }
  const shared =
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  return Object.fromEntries(courses.map((course) => [course.id, course.termStartDate ?? shared]));
}

/**
 * Whether a topic's lecture has happened by `date`. A topic with no week, or a
 * course with no known start, is assumed taught: without a calendar there is
 * nothing to hold it back with.
 */
export function isTaughtBy(weekNumber: number | null, termStart: IsoDate | null, date: IsoDate): boolean {
  if (weekNumber === null || termStart === null) return true;
  return weekNumber <= teachingWeekOf(termStart, date);
}
