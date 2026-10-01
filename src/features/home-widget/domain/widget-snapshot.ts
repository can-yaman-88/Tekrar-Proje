import type { IsoDate } from '@contracts/enums.contract';
import { courseLabel } from '@entities/course';
import { isMixedSet, isReviewTask, type Task } from '@entities/task';
import { addDays } from '@shared/lib/date';

/**
 * What the home-screen widget shows, worked out while the app is open and
 * kept on the device: Android draws the widget later, at its own times, with
 * nothing but this to go on.
 */
export interface WidgetTaskItem {
  id: string;
  title: string;
  /** "FİZ101 · Gauss yasası" */
  context: string;
  minutes: number | null;
  isOverdue: boolean;
  isUrgent: boolean;
  /**
   * Ticking it needs the app: a review asks how it went, a mixed set asks for
   * each topic's score. The widget opens the task instead.
   */
  needsApp: boolean;
}

export interface WidgetDay {
  date: IsoDate;
  /** The first few, in the order they should be done. */
  open: WidgetTaskItem[];
  /** All of them, for the "+3 iş daha" line. */
  openTotal: number;
  done: number;
  /** Topics whose review falls due on or before this day. */
  reviewsDue: number;
}

export interface WidgetSnapshot {
  version: 1;
  generatedAt: string;
  /** Today and the two days after: the widget turns the page at midnight on its own. */
  days: WidgetDay[];
}

/** More than the tallest widget can show; the rest is a "+3" line. */
export const MAX_ITEMS = 6;
const AHEAD_DAYS = 2;

const OPEN: ReadonlySet<Task['status']> = new Set(['pending', 'in_progress']);

function toItem(task: Task, day: IsoDate): WidgetTaskItem {
  return {
    id: task.id,
    title: task.title,
    context: `${courseLabel(task.course)} · ${task.topic.title}`,
    minutes: task.estimatedMinutes,
    isOverdue: task.dueDate < day,
    isUrgent: task.isPriority,
    needsApp: isReviewTask(task) || isMixedSet(task),
  };
}

/** Overdue first, then urgent, then reviews, then the day's order. */
const byWhatComesFirst = (a: WidgetTaskItem, b: WidgetTaskItem) =>
  Number(b.isOverdue) - Number(a.isOverdue) || Number(b.isUrgent) - Number(a.isUrgent);

/**
 * The widget's three days from what the app already has: the board (overdue
 * and today), the next two days' tasks, and each topic's next review.
 *
 * A group shows as one card, as on the board: its steps are not listed again.
 * What is still open today is carried into tomorrow as overdue — that is what
 * tomorrow will look like if nothing else happens.
 */
export function buildWidgetSnapshot({
  today,
  board,
  upcoming,
  reviewDates,
  now = new Date(),
}: {
  today: IsoDate;
  board: readonly Task[];
  upcoming: readonly Task[];
  /** next_review_on of every studied topic. */
  reviewDates: readonly (IsoDate | null)[];
  now?: Date;
}): WidgetSnapshot {
  const all = new Map<string, Task>();
  for (const task of [...board, ...upcoming]) all.set(task.id, task);
  const cards = [...all.values()].filter((task) => task.parentTaskId === null || !all.has(task.parentTaskId));

  const reviewsBy = (day: IsoDate) => reviewDates.filter((date) => date !== null && date <= day).length;

  const days: WidgetDay[] = [];
  let carried: Task[] = [];
  for (let offset = 0; offset <= AHEAD_DAYS; offset++) {
    const day = addDays(today, offset);
    const dueToday = cards.filter((task) =>
      offset === 0 ? task.dueDate <= day : task.dueDate === day,
    );
    const open = [...carried, ...dueToday.filter((task) => OPEN.has(task.status))];
    const done =
      offset === 0 ? dueToday.filter((task) => task.status === 'completed' && task.dueDate === day).length : 0;
    days.push({
      date: day,
      open: open
        .map((task) => toItem(task, day))
        .sort(byWhatComesFirst)
        .slice(0, MAX_ITEMS),
      openTotal: open.length,
      done,
      reviewsDue: reviewsBy(day),
    });
    carried = open;
  }

  return { version: 1, generatedAt: now.toISOString(), days };
}

/** The day to draw now; null once the snapshot has run out (the app was not opened for days). */
export function dayToShow(snapshot: WidgetSnapshot | null, today: IsoDate): WidgetDay | null {
  return snapshot?.days.find((day) => day.date === today) ?? null;
}

/** A tick on the widget: the item leaves the open list at once, before the server answers. */
export function markDone(snapshot: WidgetSnapshot, taskId: string): WidgetSnapshot {
  return {
    ...snapshot,
    days: snapshot.days.map((day, index) => {
      const had = day.open.some((item) => item.id === taskId);
      return {
        ...day,
        open: day.open.filter((item) => item.id !== taskId),
        openTotal: had ? Math.max(0, day.openTotal - 1) : day.openTotal,
        done: had && index === 0 ? day.done + 1 : day.done,
      };
    }),
  };
}

export function parseSnapshot(raw: string | null | undefined): WidgetSnapshot | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as WidgetSnapshot;
    return value && value.version === 1 && Array.isArray(value.days) ? value : null;
  } catch {
    return null;
  }
}
