// How much this student actually studies, per weekday.
//
// A single "120 minutes a day" budget is a guess that fits nobody: Monday with
// six class hours is not Saturday. This learns each weekday's own budget from
// the work that really got done, and says plainly where every number came
// from — learned, the student's own, their general average, or a default.
//
// The same function runs in the app (the capacity card), the weekly planner
// and the check-in; none of them may disagree about what a day can hold.
import type { IsoDate } from '../contracts/enums.contract.ts';

export interface CapacitySample {
  /** The day the work was done, on the student's own calendar. */
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
export const MIN_CAPACITY = 30;
/** A long Saturday is real; a 12-hour "day" in the data is a timer left running. */
export const MAX_CAPACITY = 480;
/**
 * However full the timetable, a guessed day keeps room for one concept +
 * Feynman sitting (55 minutes). Never more than the day's own budget, though:
 * a day the student rarely studies stays what it is.
 */
export const CLASS_DAY_FLOOR = 60;
/** Below this many observed occurrences a weekday keeps the default. */
const MIN_OBSERVATIONS = 2;
/**
 * How many days in the whole window must show real work before any of these
 * numbers are believed.
 *
 * A zero Wednesday means something only once it sits next to days that are not
 * zero: then it really is a light day. For a student who has finished nothing
 * yet — a new account, or a term not started — every day is zero, and reading
 * that as "you manage no minutes a day" hands them the floor for the rest of
 * term. Absence of evidence is not evidence of an empty week.
 */
const MIN_ACTIVE_DAYS = 2;
/** A day with nothing finished still counts: it is part of the average. */
export const LOOKBACK_WEEKS = 6;
/**
 * Each week further back counts this much less. Habits change over a term —
 * exam season, a new job — and last week says more about next week than the
 * first week of term does.
 */
const WEEKLY_DECAY = 0.85;
/** A finished task with no estimate still took time; the same guess the planners make. */
export const ASSUMED_TASK_MINUTES = 30;
/** A class hour costs this share of a day whose budget is only a guess. */
export const CLASS_MINUTE_COST = 0.5;

const isoWeekday = (date: IsoDate): number => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
};

const addDays = (date: IsoDate, days: number): IsoDate => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const daysBetween = (from: IsoDate, to: IsoDate): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const clamp = (minutes: number): number => Math.min(MAX_CAPACITY, Math.max(MIN_CAPACITY, Math.round(minutes)));

interface WeekdayStats {
  /** Recency-weighted mean of this weekday's days, before any floor. */
  mean: number;
  observations: number;
  activeDays: number;
}

interface History {
  byWeekday: Map<number, WeekdayStats>;
  /** The days actually used: from the first day with work, to the end of the window. */
  days: IsoDate[];
  activeDays: number;
  /** Recency-weighted mean over every day of the history. */
  overallMean: number | null;
}

/**
 * The history the numbers are read from.
 *
 * It starts on the first day any work shows up, not at the edge of the
 * window: a student who started using the app two weeks ago did not spend the
 * four weeks before that studying nothing. Counting those weeks as zeros is
 * what made a real 90-minute Monday read as 30.
 */
function readHistory(samples: readonly CapacitySample[], observedDays: readonly IsoDate[]): History {
  const minutesByDay = new Map<IsoDate, number>();
  for (const day of observedDays) minutesByDay.set(day, 0);
  for (const sample of samples) {
    if (!minutesByDay.has(sample.date)) continue; // outside the window
    minutesByDay.set(sample.date, (minutesByDay.get(sample.date) ?? 0) + Math.max(0, sample.minutes));
  }

  const ordered = [...minutesByDay.keys()].sort();
  const firstActive = ordered.find((day) => (minutesByDay.get(day) ?? 0) > 0);
  const days = firstActive === undefined ? ordered : ordered.filter((day) => day >= firstActive);
  const lastDay = ordered.at(-1);

  const totals = new Map<number, { weighted: number; weight: number; observations: number; activeDays: number }>();
  let activeDays = 0;
  let overallWeighted = 0;
  let overallWeight = 0;
  for (const day of days) {
    const minutes = minutesByDay.get(day) ?? 0;
    const weeksAgo = lastDay === undefined ? 0 : Math.floor(daysBetween(day, lastDay) / 7);
    const weight = WEEKLY_DECAY ** weeksAgo;
    const weekday = isoWeekday(day);
    const current = totals.get(weekday) ?? { weighted: 0, weight: 0, observations: 0, activeDays: 0 };
    current.weighted += minutes * weight;
    current.weight += weight;
    current.observations += 1;
    if (minutes > 0) {
      current.activeDays += 1;
      activeDays += 1;
    }
    totals.set(weekday, current);
    overallWeighted += minutes * weight;
    overallWeight += weight;
  }

  const byWeekday = new Map<number, WeekdayStats>();
  for (const [weekday, total] of totals) {
    byWeekday.set(weekday, {
      mean: total.weight === 0 ? 0 : total.weighted / total.weight,
      observations: total.observations,
      activeDays: total.activeDays,
    });
  }

  return { byWeekday, days, activeDays, overallMean: overallWeight === 0 ? null : overallWeighted / overallWeight };
}

/**
 * @param samples work done, one entry per task or timed session
 * @param observedDays every calendar day covered by the window, so that days
 *        with no work pull the average down instead of vanishing
 */
export function learnDailyCapacity(
  samples: readonly CapacitySample[],
  observedDays: readonly IsoDate[],
  fallback: number = DEFAULT_DAILY_CAPACITY,
): LearnedCapacity {
  const history = readHistory(samples, observedDays);
  const hasEvidence = history.activeDays >= MIN_ACTIVE_DAYS;
  // A weekday not yet seen often enough takes the student's general pace, not
  // a number that came from nowhere.
  const general = hasEvidence && history.overallMean !== null ? clamp(history.overallMean) : clamp(fallback);

  const minutesByWeekday: Record<number, number> = {};
  const learnedWeekdays: number[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    const stats = history.byWeekday.get(weekday);
    if (!hasEvidence || !stats || stats.observations < MIN_OBSERVATIONS) {
      minutesByWeekday[weekday] = general;
      continue;
    }
    minutesByWeekday[weekday] = clamp(stats.mean);
    learnedWeekdays.push(weekday);
  }

  return {
    minutesByWeekday,
    learnedWeekdays,
    observedWeeks: Math.round((history.days.length / 7) * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// From raw records to a week the planners can use.
// ---------------------------------------------------------------------------

/** A task finished inside the window. */
export interface FinishedWork {
  taskId: string;
  /** Set on the steps of a group task. */
  parentTaskId: string | null;
  /** The day it was finished, on the student's own calendar. */
  finishedOn: IsoDate;
  estimatedMinutes: number | null;
}

/** A stopwatch reading. */
export interface TimedWork {
  taskId: string;
  /** The day the clock was started, on the student's own calendar. */
  startedOn: IsoDate;
  minutes: number;
}

/**
 * Turns finished tasks and stopwatch readings into minutes per day.
 *
 * · a task that was timed counts its real minutes, on the days they were
 *   spent; its estimate is dropped, or the same hour would count twice
 * · a task that was not timed counts its estimate on the day it was finished
 *   — and a task with no estimate still took some time
 * · a group task is only a container: its steps carry the work, so it adds
 *   nothing of its own (it used to double every homework that had steps)
 */
export function workSamples(
  finished: readonly FinishedWork[],
  timed: readonly TimedWork[],
): { samples: CapacitySample[]; measuredDays: number } {
  const timedTasks = new Set(timed.map((session) => session.taskId));
  const containers = new Set(finished.flatMap((task) => (task.parentTaskId === null ? [] : [task.parentTaskId])));

  const samples: CapacitySample[] = timed.map((session) => ({ date: session.startedOn, minutes: session.minutes }));
  for (const task of finished) {
    if (containers.has(task.taskId) || timedTasks.has(task.taskId)) continue;
    samples.push({ date: task.finishedOn, minutes: task.estimatedMinutes ?? ASSUMED_TASK_MINUTES });
  }
  return { samples, measuredDays: new Set(timed.map((session) => session.startedOn)).size };
}

/** Where a weekday's number came from — the card says so, and the planner treats them differently. */
export type CapacitySource = 'blocked' | 'override' | 'learned' | 'general' | 'default';

export interface WeekdayCapacity {
  /** ISO weekday, 1 = Monday. */
  weekday: number;
  /** What the planners start from (class hours are applied separately). */
  minutes: number;
  source: CapacitySource;
  /** What the history says for this weekday, before floors and overrides; null without evidence. */
  observedMinutes: number | null;
  /** How many of this weekday the history holds, and on how many of them work was done. */
  observations: number;
  activeDays: number;
}

export interface CapacityProfile {
  /** Monday to Sunday. */
  days: WeekdayCapacity[];
  minutesByWeekday: Record<number, number>;
  /** Weekdays whose number is the student's own history. */
  learnedWeekdays: number[];
  /** First day of the history actually used; null when there is none. */
  historyStart: IsoDate | null;
  historyDays: number;
  /** Days in the history with any work at all. */
  activeDays: number;
  /** Days whose minutes came from the stopwatch. */
  measuredDays: number;
  /** Recency-weighted minutes per day over the whole history; null without evidence. */
  averageMinutes: number | null;
}

export interface CapacityInput {
  /** The history ends the day before this. */
  today: IsoDate;
  finished: readonly FinishedWork[];
  timed: readonly TimedWork[];
  blockedWeekdays?: readonly number[];
  /** The student's own minutes per ISO weekday. */
  overrides?: Readonly<Record<number, number>>;
}

/**
 * The whole answer: per weekday, a number and its provenance.
 *
 * Precedence: a blocked day is worth nothing; then the student's own number;
 * then what their history shows; then their general pace; then the default.
 */
export function resolveCapacity({ today, finished, timed, blockedWeekdays = [], overrides = {} }: CapacityInput): CapacityProfile {
  const windowStart = addDays(today, -LOOKBACK_WEEKS * 7);
  const windowDays: IsoDate[] = [];
  for (let day = windowStart; day < today; day = addDays(day, 1)) windowDays.push(day);

  const inWindow = (day: IsoDate) => day >= windowStart && day < today;
  const { samples, measuredDays } = workSamples(
    finished.filter((task) => inWindow(task.finishedOn)),
    timed.filter((session) => inWindow(session.startedOn)),
  );

  const history = readHistory(samples, windowDays);
  const learned = learnDailyCapacity(samples, windowDays);
  const hasEvidence = history.activeDays >= MIN_ACTIVE_DAYS;
  const blocked = new Set(blockedWeekdays);

  const days: WeekdayCapacity[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    const stats = history.byWeekday.get(weekday);
    const observedMinutes = hasEvidence && stats ? Math.round(stats.mean) : null;
    const override = overrides[weekday];
    const isLearned = learned.learnedWeekdays.includes(weekday);
    const base = {
      weekday,
      observedMinutes,
      observations: stats?.observations ?? 0,
      activeDays: stats?.activeDays ?? 0,
    };

    if (blocked.has(weekday)) {
      days.push({ ...base, minutes: 0, source: 'blocked' });
    } else if (override !== undefined && Number.isFinite(override) && override > 0) {
      days.push({ ...base, minutes: Math.min(600, Math.max(15, Math.round(override))), source: 'override' });
    } else {
      days.push({
        ...base,
        minutes: learned.minutesByWeekday[weekday] ?? DEFAULT_DAILY_CAPACITY,
        source: isLearned ? 'learned' : hasEvidence ? 'general' : 'default',
      });
    }
  }

  return {
    days,
    minutesByWeekday: Object.fromEntries(days.map((day) => [day.weekday, day.minutes])),
    learnedWeekdays: learned.learnedWeekdays,
    historyStart: history.activeDays > 0 ? (history.days[0] ?? null) : null,
    historyDays: history.activeDays > 0 ? history.days.length : 0,
    activeDays: history.activeDays,
    measuredDays,
    averageMinutes: hasEvidence && history.overallMean !== null ? Math.round(history.overallMean) : null,
  };
}

/**
 * The minutes a planner may fill on one day.
 *
 * Class hours only shrink a budget that is a guess. A learned number already
 * is the student's real Monday — six class hours included — and their own
 * number is theirs to decide; taking class time off those as well punished
 * the same lecture twice.
 */
export function planningBudget(day: Pick<WeekdayCapacity, 'minutes' | 'source'>, classMinutes: number): number {
  if (day.source === 'blocked' || day.minutes <= 0) return 0;
  if (day.source === 'learned' || day.source === 'override') return day.minutes;
  const floor = Math.min(day.minutes, CLASS_DAY_FLOOR);
  return Math.max(floor, Math.round(day.minutes - classMinutes * CLASS_MINUTE_COST));
}

/**
 * The student's own numbers, as stored on the profile ({"1": 90, "6": 180}).
 * Anything that is not a weekday and a sane number of minutes is ignored.
 */
export function parseCapacityOverrides(value: unknown): Record<number, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: Record<number, number> = {};
  for (const [key, minutes] of Object.entries(value as Record<string, unknown>)) {
    const weekday = Number(key);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) continue;
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 15 || minutes > 600) continue;
    result[weekday] = Math.round(minutes);
  }
  return result;
}

/**
 * A timestamp's calendar day in an IANA timezone ("Europe/Istanbul").
 *
 * The server needs this to put work on the day the student did it: slicing a
 * UTC timestamp puts a 01:30 session on the wrong side of midnight for half
 * the world. An unknown zone falls back to UTC rather than throwing.
 */
export function localDateIn(timestamp: string, timeZone: string): IsoDate {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(timestamp));
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const date = `${part('year')}-${part('month')}-${part('day')}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : timestamp.slice(0, 10);
  } catch {
    return timestamp.slice(0, 10);
  }
}
