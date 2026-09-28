// How much of a piece of deadline work belongs to each day.
//
// A homework due on Monday is not a Monday task: it is three evenings of work
// with a Monday deadline. Splitting it is only honest if it is split against
// what those evenings already hold — a day with six hours of class and two
// loop tasks has no room left, however generous the weekly average looks. So
// every share here is carved out of a day's FREE capacity: what is left after
// the work already due that day.
//
// Pure arithmetic, shared by the app (what to do today) and the weekly planner
// (what room is left for the study loop), so the two can never disagree.
import type { IsoDate } from '../contracts/enums.contract.ts';
import { addDays } from './dates.ts';

export interface DeadlineTask {
  id: string;
  dueDate: IsoDate;
  /** Earliest day the student wants to touch it; null = derived from the window. */
  startsOn: IsoDate | null;
  /** Minutes still to do. */
  remainingMinutes: number;
  /** Questions still to do, when the work is countable. */
  remainingCount: number | null;
  /** Minutes one question costs; null when the work is not countable. */
  minutesPerUnit: number | null;
  /**
   * Days the student decided for themselves: minutes per day, 0 meaning "not
   * this day". These are honoured exactly; only what is left over is shared
   * out by the automatic rule.
   */
  fixedByDate?: Readonly<Record<string, number>>;
}

export interface DayBudget {
  date: IsoDate;
  /** What this weekday is worth for this student, in minutes. */
  capacityMinutes: number;
  /** Minutes already spoken for by work due that day. */
  committedMinutes: number;
}

export interface Share {
  taskId: string;
  date: IsoDate;
  minutes: number;
  /** Questions this share works out to, when the work is countable. */
  count: number | null;
  /** True when the student set this day themselves. */
  isManual: boolean;
}

export interface DeadlinePressure {
  taskId: string;
  dueDate: IsoDate;
  remainingMinutes: number;
  /** Everything the days up to the deadline can still take. */
  freeMinutes: number;
  /** What will not fit however the days are arranged. */
  shortfallMinutes: number;
}

export interface WorkloadPlan {
  shares: Share[];
  pressure: DeadlinePressure[];
}

/** Work is spread over at most this many days before its deadline. */
export const WINDOW_DAYS = 7;
/** Below this a slice is not worth sitting down for; it moves to another day. */
const MIN_CHUNK = 15;
/** Shares are rounded to whole five minutes — nobody plans 7 minutes of work. */
const STEP = 5;
const MAX_BALANCE_PASSES = 8;

const roundToStep = (minutes: number): number => Math.round(minutes / STEP) * STEP;
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

interface Slot {
  date: IsoDate;
  free: number;
}

/** Minutes → questions, for work that is counted in questions. */
const countFor = (task: DeadlineTask, minutes: number): number | null =>
  task.minutesPerUnit === null || task.minutesPerUnit <= 0
    ? null
    : Math.max(1, Math.min(task.remainingCount ?? Infinity, Math.round(minutes / task.minutesPerUnit)));

/**
 * Splits `allocatable` minutes over the slots in proportion to their free
 * capacity, then makes the result something a person can act on: whole
 * five-minute blocks, no slice smaller than a quarter of an hour, and never
 * more than a day can take.
 */
function distribute(allocatable: number, slots: readonly Slot[]): Map<IsoDate, number> {
  const result = new Map<IsoDate, number>();
  if (allocatable <= 0) return result;

  let active = slots.filter((slot) => slot.free > 0);
  if (active.length === 0) return result;

  // Drop the thinnest slice and share it out again, until what is left is
  // worth doing. A single day that cannot reach MIN_CHUNK keeps its share:
  // the work is simply small. Equal slices are dropped from the back, so the
  // work sits as early as it can and the days before the deadline stay as
  // slack rather than as plan.
  for (let pass = 0; pass < MAX_BALANCE_PASSES && active.length > 1; pass++) {
    const totalFree = sum(active.map((slot) => slot.free));
    const raw = active.map((slot) => ({ slot, minutes: (allocatable * slot.free) / totalFree }));
    const thinnest = raw.reduce((min, entry) => (entry.minutes <= min.minutes ? entry : min));
    if (thinnest.minutes >= MIN_CHUNK || allocatable < MIN_CHUNK) break;
    active = active.filter((slot) => slot.date !== thinnest.slot.date);
  }

  const totalFree = sum(active.map((slot) => slot.free));
  for (const slot of active) {
    const raw = (allocatable * slot.free) / totalFree;
    result.set(slot.date, Math.min(slot.free, Math.max(STEP, roundToStep(raw))));
  }

  // Rounding drifts; give the difference to (or take it from) the day with the
  // most room, so the total still matches the work that has to be done.
  let drift = allocatable - sum([...result.values()]);
  for (let pass = 0; pass < MAX_BALANCE_PASSES && Math.abs(drift) >= STEP; pass++) {
    const ordered = [...active].sort((a, b) => b.free - a.free);
    let moved = false;
    for (const slot of ordered) {
      const current = result.get(slot.date) ?? 0;
      if (drift > 0 && current + STEP <= slot.free) {
        result.set(slot.date, current + STEP);
        drift -= STEP;
        moved = true;
      } else if (drift < 0 && current - STEP >= 0) {
        const next = current - STEP;
        if (next === 0) result.delete(slot.date);
        else result.set(slot.date, next);
        drift += STEP;
        moved = true;
      }
      if (Math.abs(drift) < STEP) break;
    }
    if (!moved) break;
  }

  return result;
}

/**
 * @param days every day the caller cares about, in order. Days outside a
 *        task's window are simply never offered to it.
 */
export function planDeadlineWork({
  today,
  days,
  tasks,
}: {
  today: IsoDate;
  days: readonly DayBudget[];
  tasks: readonly DeadlineTask[];
}): WorkloadPlan {
  // A running copy: each share taken reduces what the next deadline can use.
  const committed = new Map<IsoDate, number>(days.map((day) => [day.date, day.committedMinutes]));
  const capacity = new Map<IsoDate, number>(days.map((day) => [day.date, day.capacityMinutes]));

  const shares: Share[] = [];
  const pressure: DeadlinePressure[] = [];

  // Earliest deadline first: the work that runs out of time first gets the
  // room it needs before anything else is allowed to take it.
  const ordered = [...tasks].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || b.remainingMinutes - a.remainingMinutes,
  );

  for (const task of ordered) {
    if (task.remainingMinutes <= 0) continue;

    const windowStart = task.startsOn ?? addDays(task.dueDate, -WINDOW_DAYS);
    const from = windowStart > today ? windowStart : today;
    const inWindow = days.filter((day) => day.date >= from && day.date <= task.dueDate);

    // What the student pinned by hand comes off the top: those days are
    // settled, and the automatic share works on what is left of the work.
    const fixed = task.fixedByDate ?? {};
    let fixedTotal = 0;
    for (const day of inWindow) {
      const pinned = fixed[day.date];
      if (pinned === undefined) continue;
      const minutes = Math.max(0, Math.min(Math.round(pinned), task.remainingMinutes - fixedTotal));
      if (minutes <= 0) continue;
      fixedTotal += minutes;
      committed.set(day.date, (committed.get(day.date) ?? 0) + minutes);
      shares.push({
        taskId: task.id,
        date: day.date,
        minutes,
        count: countFor(task, minutes),
        isManual: true,
      });
    }

    const autoRemaining = Math.max(0, task.remainingMinutes - fixedTotal);
    const slots: Slot[] = inWindow
      // A day the student pinned — including the ones they switched off — is
      // not up for automatic sharing any more.
      .filter((day) => fixed[day.date] === undefined)
      .map((day) => ({
        date: day.date,
        free: Math.max(0, (capacity.get(day.date) ?? 0) - (committed.get(day.date) ?? 0)),
      }));

    if (autoRemaining <= 0) continue;

    const freeMinutes = sum(slots.map((slot) => slot.free));
    if (freeMinutes < autoRemaining) {
      pressure.push({
        taskId: task.id,
        dueDate: task.dueDate,
        remainingMinutes: autoRemaining,
        freeMinutes,
        shortfallMinutes: autoRemaining - freeMinutes,
      });
    }

    const allocated = distribute(Math.min(autoRemaining, freeMinutes), slots);
    for (const [date, minutes] of allocated) {
      committed.set(date, (committed.get(date) ?? 0) + minutes);
      shares.push({ taskId: task.id, date, minutes, count: countFor(task, minutes), isManual: false });
    }
  }

  shares.sort((a, b) => a.date.localeCompare(b.date));
  return { shares, pressure };
}

/** The slice of a given day, for one task. */
export const shareFor = (plan: WorkloadPlan, taskId: string, date: IsoDate): Share | null =>
  plan.shares.find((share) => share.taskId === taskId && share.date === date) ?? null;

/** Minutes this plan books on a day, across every task. */
export const bookedOn = (plan: WorkloadPlan, date: IsoDate): number =>
  plan.shares.filter((share) => share.date === date).reduce((total, share) => total + share.minutes, 0);
