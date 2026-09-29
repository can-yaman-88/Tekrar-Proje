// How much this student actually studies, per weekday.
//
// A single "120 minutes a day" budget is a guess that fits nobody: Monday with
// six class hours is not Saturday. This learns each weekday's own budget from
// the work that really got finished, and falls back to a default while there is
// not enough history to be honest about.
import type { IsoDate } from '../contracts/enums.contract.ts';

export interface CapacitySample {
  /** The day the work was finished. */
  date: IsoDate;
  minutes: number;
}

export interface LearnedCapacity {
  /** ISO weekday (1 = Monday) → minutes the student tends to manage. */
  minutesByWeekday: Record<number, number>;
  /** Weekdays with enough observations to be trusted. */
  learnedWeekdays: number[];
  /** Weeks of history the numbers are based on. */
  observedWeeks: number;
}

/**
 * A day's study budget until the student's own history says otherwise. Class
 * hours still come off it; at 120 a weekday with four classes fell to the
 * 30-minute floor and no concept+Feynman sitting (55 minutes) ever fit.
 */
export const DEFAULT_DAILY_CAPACITY = 150;
const MIN_CAPACITY = 30;
const MAX_CAPACITY = 300;
/** Below this many observed occurrences a weekday keeps the default. */
const MIN_OBSERVATIONS = 2;
/**
 * How many days in the whole window must show real work before any of these
 * numbers are believed.
 *
 * A zero Wednesday means something only once it sits next to days that are not
 * zero: then it really is a light day. For a student who has finished nothing
 * yet — a new account, or a term not started — every day is zero, and reading
 * that as "you manage no minutes a day" hands them the 30-minute floor for the
 * rest of term. Absence of evidence is not evidence of an empty week.
 */
const MIN_ACTIVE_DAYS = 2;
/** A day with nothing finished still counts: it is part of the average. */
const LOOKBACK_WEEKS = 6;

const isoWeekday = (date: IsoDate): number => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
};

const clamp = (minutes: number): number => Math.min(MAX_CAPACITY, Math.max(MIN_CAPACITY, Math.round(minutes)));

/**
 * @param samples finished work, one entry per task
 * @param observedDays every calendar day covered by the history, so that days
 *        with no finished work pull the average down instead of vanishing
 */
export function learnDailyCapacity(
  samples: readonly CapacitySample[],
  observedDays: readonly IsoDate[],
  fallback: number = DEFAULT_DAILY_CAPACITY,
): LearnedCapacity {
  const minutesByDay = new Map<IsoDate, number>();
  for (const day of observedDays) minutesByDay.set(day, 0);
  for (const sample of samples) {
    if (!minutesByDay.has(sample.date)) continue; // outside the window
    minutesByDay.set(sample.date, (minutesByDay.get(sample.date) ?? 0) + Math.max(0, sample.minutes));
  }

  const totals = new Map<number, { minutes: number; days: number }>();
  let activeDays = 0;
  for (const [day, minutes] of minutesByDay) {
    const weekday = isoWeekday(day);
    const current = totals.get(weekday) ?? { minutes: 0, days: 0 };
    current.minutes += minutes;
    current.days += 1;
    if (minutes > 0) activeDays += 1;
    totals.set(weekday, current);
  }

  const hasEvidence = activeDays >= MIN_ACTIVE_DAYS;

  const minutesByWeekday: Record<number, number> = {};
  const learnedWeekdays: number[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    const total = totals.get(weekday);
    if (!hasEvidence || !total || total.days < MIN_OBSERVATIONS) {
      minutesByWeekday[weekday] = clamp(fallback);
      continue;
    }
    minutesByWeekday[weekday] = clamp(total.minutes / total.days);
    learnedWeekdays.push(weekday);
  }

  return {
    minutesByWeekday,
    learnedWeekdays,
    observedWeeks: Math.round((observedDays.length / 7) * 10) / 10,
  };
}

export { LOOKBACK_WEEKS };

/**
 * Merges measured study time with estimates.
 *
 * A stopwatch reading beats a guess, but only for the days it covers: on a day
 * the student timed nothing, the estimates of what they finished are still the
 * best evidence there is. So measured days replace their estimates entirely
 * (otherwise the same hour would be counted twice), and untimed days keep them.
 */
export function buildCapacitySamples(
  measured: readonly CapacitySample[],
  estimated: readonly CapacitySample[],
): { samples: CapacitySample[]; measuredDays: number } {
  const measuredDays = new Set(measured.map((sample) => sample.date));
  return {
    samples: [...measured, ...estimated.filter((sample) => !measuredDays.has(sample.date))],
    measuredDays: measuredDays.size,
  };
}
