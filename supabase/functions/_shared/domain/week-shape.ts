// Repairing the shape of a week.
//
// The planner lays out a good week; life then bends it. A day gets emptied and
// its quiz lands before the Feynman page it is supposed to test. A topic's
// concept page drifts one day away from its Feynman page, so the student reads
// twice instead of recalling once. A Monday quietly collects five cards.
//
// This is not "plan the week again" — that would throw away everything the
// student has already arranged. It is a repair: find the places where the
// week breaks its own rules, and make the smallest set of moves that fixes
// them. Work that already obeys every rule is never touched.
//
// The rules, in the order they win:
//
//   1. Concept and Feynman are one sitting: same day, always.
//   2. The quiz never comes before the Feynman page: the same day, or any day
//      after it. (It used to be forced to a later day; the student works the
//      quiz right after the page just as often, and a rule that pushed every
//      quiz a day on only crowded the week.)
//   3. Advanced problems come after the quiz.
//   4. A day holds what it can hold: its minutes, and at most as many cards as
//      the student asked for.
//   5. A deadline is never crossed. Homework may be pulled earlier; it may not
//      be pushed past its own due date.
//
// The unit of placement is the CARD, not the row: a learning task and its two
// steps move together, as one thing worth one slot.
import type { IsoDate, StudyStep, TaskType } from '../contracts/enums.contract.ts';

/**
 * The cycle step a task represents, or null when it has no place in the order.
 *
 * Homework, mock exams and the learning container itself are outside the loop:
 * nothing says they must come before or after anything.
 */
export function studyStepOf(type: TaskType): StudyStep | null {
  switch (type) {
    case 'concept_note':
    case 'feynman':
    case 'quiz':
    case 'advanced_problems':
      return type;
    default:
      return null;
  }
}

export interface ShapeTask {
  id: string;
  topicId: string;
  /** The cycle step this task is, or null for homework and containers. */
  step: StudyStep | null;
  dueDate: IsoDate;
  estimatedMinutes: number;
  /** Set when this task is a step of another; steps travel with their parent. */
  parentId: string | null;
  /** Work with a real deadline: it may move earlier, never later. */
  hasDeadline: boolean;
  /** Still to do, and not in the past: anything else keeps the day it happened on. */
  isMovable: boolean;
}

export interface ShapeDay {
  date: IsoDate;
  capacityMinutes: number;
  /** How many cards this day may hold; null = only minutes decide. */
  maxMainTasks: number | null;
}

export type ShapeReason =
  | 'pair'
  | 'quiz_after_feynman'
  | 'advanced_after_quiz'
  | 'day_cap'
  | 'capacity';

export interface ShapeMove {
  taskId: string;
  /** Every task of one card shares a unit id, so a preview can speak in cards. */
  unitId: string;
  from: IsoDate;
  to: IsoDate;
  reason: ShapeReason;
}

/** Two loose tasks that belong in one learning task, once they share a day. */
export interface ShapePairing {
  topicId: string;
  conceptTaskId: string;
  feynmanTaskId: string;
  date: IsoDate;
}

export interface WeekShapePlan {
  moves: ShapeMove[];
  pairings: ShapePairing[];
  /** What could not be fixed, in the student's language. */
  notes: string[];
}

/** A task with no estimate still takes time; the same assumption as everywhere else. */
const ASSUMED_TASK_MINUTES = 30;

/** Later in the cycle = first to give up its day when one is over full. */
const STEP_RANK: Record<StudyStep, number> = {
  concept_note: 0,
  feynman: 1,
  quiz: 2,
  advanced_problems: 3,
};

interface Unit {
  id: string;
  taskIds: string[];
  topicId: string;
  date: IsoDate;
  minutes: number;
  steps: Set<StudyStep>;
  isMovable: boolean;
  hasDeadline: boolean;
  /** The earliest deadline among this card's tasks, when it has one. */
  deadline: IsoDate | null;
}

export function planWeekShape({
  today,
  days,
  tasks,
  groupExistingPairs = false,
}: {
  today: IsoDate;
  days: readonly ShapeDay[];
  tasks: readonly ShapeTask[];
  groupExistingPairs?: boolean;
}): WeekShapePlan {
  const moves: ShapeMove[] = [];
  const notes: string[] = [];
  if (days.length === 0) return { moves, pairings: [], notes };

  const byId = new Map(tasks.map((task) => [task.id, task]));
  const dayIndex = new Map(days.map((day, index) => [day.date, index]));

  // --- Cards. A step belongs to its parent's card; everything else is its own.
  const units = new Map<string, Unit>();
  const unitOfTask = new Map<string, string>();
  for (const task of tasks) {
    const leader = task.parentId !== null && byId.has(task.parentId) ? task.parentId : task.id;
    const existing = units.get(leader);
    const minutes = task.estimatedMinutes > 0 ? task.estimatedMinutes : 0;
    if (existing) {
      existing.taskIds.push(task.id);
      existing.minutes += minutes;
      if (task.step) existing.steps.add(task.step);
      // A card is only as movable as its least movable part.
      existing.isMovable &&= task.isMovable;
      if (task.hasDeadline) {
        existing.hasDeadline = true;
        existing.deadline =
          existing.deadline === null || task.dueDate < existing.deadline ? task.dueDate : existing.deadline;
      }
      // The container's own day is the card's day; a step without one follows it.
      if (task.id === leader) existing.date = task.dueDate;
    } else {
      units.set(leader, {
        id: leader,
        taskIds: [task.id],
        topicId: task.topicId,
        date: task.dueDate,
        minutes,
        steps: new Set(task.step ? [task.step] : []),
        isMovable: task.isMovable,
        hasDeadline: task.hasDeadline,
        deadline: task.hasDeadline ? task.dueDate : null,
      });
    }
    unitOfTask.set(task.id, leader);
  }
  // A card with no estimate anywhere still costs something.
  for (const unit of units.values()) {
    if (unit.minutes === 0) unit.minutes = ASSUMED_TASK_MINUTES;
  }

  // --- What each day already carries, including work that cannot move.
  const load = new Map<IsoDate, { minutes: number; cards: number }>(
    days.map((day) => [day.date, { minutes: 0, cards: 0 }]),
  );
  for (const unit of units.values()) {
    const day = load.get(unit.date);
    if (!day) continue; // outside the window: not ours to balance
    day.minutes += unit.minutes;
    day.cards += 1;
  }

  const capacityOf = (date: IsoDate): ShapeDay | undefined => days[dayIndex.get(date) ?? -1];

  const fits = (unit: Unit, day: ShapeDay): boolean => {
    if (unit.deadline !== null && day.date > unit.deadline) return false;
    if (day.date < today) return false;
    const current = load.get(day.date);
    if (!current) return false;
    if (day.maxMainTasks !== null && current.cards + 1 > day.maxMainTasks) return false;
    return current.minutes + unit.minutes <= day.capacityMinutes;
  };

  const moveUnit = (unit: Unit, to: IsoDate, reason: ShapeReason): void => {
    if (unit.date === to) return;
    const from = load.get(unit.date);
    if (from) {
      from.minutes -= unit.minutes;
      from.cards -= 1;
    }
    const target = load.get(to);
    if (target) {
      target.minutes += unit.minutes;
      target.cards += 1;
    }
    for (const taskId of unit.taskIds) {
      const task = byId.get(taskId);
      if (!task || task.dueDate === to) continue;
      moves.push({ taskId, unitId: unit.id, from: task.dueDate, to, reason });
    }
    unit.date = to;
  };

  /** The first day at or after `minIndex` that can take this card. */
  const firstFitting = (unit: Unit, minIndex: number): ShapeDay | undefined =>
    days.find((day, index) => index >= minIndex && fits(unit, day));

  // --- Per topic: which card carries which step.
  const byTopic = new Map<string, Unit[]>();
  for (const unit of units.values()) {
    if (unit.steps.size === 0) continue;
    byTopic.set(unit.topicId, [...(byTopic.get(unit.topicId) ?? []), unit]);
  }
  const carrierOf = (topicUnits: readonly Unit[], step: StudyStep): Unit | undefined =>
    topicUnits.find((unit) => unit.steps.has(step));

  const pairings: ShapePairing[] = [];
  const topics = [...byTopic.keys()].sort();

  // --- Rule 1: the concept page and the Feynman page are one sitting.
  for (const topicId of topics) {
    const topicUnits = byTopic.get(topicId) ?? [];
    const concept = carrierOf(topicUnits, 'concept_note');
    const feynman = carrierOf(topicUnits, 'feynman');
    if (!concept || !feynman || concept === feynman || concept.date === feynman.date) continue;

    // Whichever of the two can move goes to the other's day; when both can, the
    // earlier day wins, because pulling work forward beats pushing it back.
    const earlier = concept.date <= feynman.date ? concept : feynman;
    const later = earlier === concept ? feynman : concept;
    const earlierDay = capacityOf(earlier.date);
    const laterDay = capacityOf(later.date);

    if (later.isMovable && earlierDay && fits(later, earlierDay)) {
      moveUnit(later, earlier.date, 'pair');
    } else if (earlier.isMovable && laterDay && fits(earlier, laterDay)) {
      moveUnit(earlier, later.date, 'pair');
    } else if (later.isMovable && earlier.isMovable) {
      // Neither day can hold both: find one that can, from today onwards.
      const merged: Unit = { ...earlier, minutes: earlier.minutes + later.minutes, taskIds: [] };
      const home = firstFitting(merged, 0);
      if (home) {
        moveUnit(earlier, home.date, 'pair');
        moveUnit(later, home.date, 'pair');
      } else {
        notes.push('Konsept ile Feynman aynı güne sığmadı; ayrı günlerde kaldılar.');
      }
    } else {
      notes.push('Konsept ve Feynman farklı günlerde kaldı; ikisi de taşınamıyor.');
    }
  }

  /**
   * Keeps a step's card from coming before another step's card — on the same
   * day or later when `sameDay` allows it, strictly later when it does not.
   */
  const enforceOrder = (
    topicUnits: readonly Unit[],
    afterStep: StudyStep,
    step: StudyStep,
    reason: ShapeReason,
    note: string,
    sameDay: boolean,
  ): void => {
    const anchor = carrierOf(topicUnits, afterStep);
    const target = carrierOf(topicUnits, step);
    if (!anchor || !target || anchor === target) return;
    if (target.date > anchor.date || (sameDay && target.date === anchor.date)) return; // in order: nothing to fix
    if (!target.isMovable) {
      notes.push(note);
      return;
    }
    const anchorIndex = dayIndex.get(anchor.date);
    const home = firstFitting(target, anchorIndex === undefined ? 0 : anchorIndex + (sameDay ? 0 : 1));
    if (home) moveUnit(target, home.date, reason);
    else notes.push(note);
  };

  // --- Rules 2 and 3: the quiz not before the page, harder problems after the quiz.
  for (const topicId of topics) {
    const topicUnits = byTopic.get(topicId) ?? [];
    enforceOrder(
      topicUnits,
      'feynman',
      'quiz',
      'quiz_after_feynman',
      'Sınavı Feynman gününe ya da sonrasına alacak yer kalmadı.',
      true,
    );
    enforceOrder(
      topicUnits,
      'quiz',
      'advanced_problems',
      'advanced_after_quiz',
      'İleri seviye soruları sınavdan sonraya alacak boş gün kalmadı.',
      false,
    );
  }

  // --- Rules 4: a day holds what it can hold.
  //
  // The card that gives up its day is the one furthest along the cycle with no
  // deadline behind it: moving a quiz costs the student nothing, moving the
  // concept page moves the whole topic.
  const cost = (unit: Unit): number => {
    const step = [...unit.steps].reduce<number>((worst, value) => Math.max(worst, STEP_RANK[value]), -1);
    return (unit.hasDeadline ? -100 : 0) + step;
  };

  let capacityNoted = false;
  let capNoted = false;
  for (const [index, day] of days.entries()) {
    let guard = 0;
    for (;;) {
      const current = load.get(day.date);
      if (!current) break;
      const overCards = day.maxMainTasks !== null && current.cards > day.maxMainTasks;
      const overMinutes = current.minutes > day.capacityMinutes;
      if ((!overCards && !overMinutes) || guard++ > days.length * 4) break;

      const candidates = [...units.values()]
        .filter((unit) => unit.date === day.date && unit.isMovable)
        .sort((a, b) => cost(b) - cost(a) || b.minutes - a.minutes || a.id.localeCompare(b.id));
      const leaving = candidates[0];
      if (!leaving) break;

      // Its own order constraints still hold: a quiz cannot slide before its
      // Feynman page just because Monday is crowded.
      const topicUnits = byTopic.get(leaving.topicId) ?? [];
      const anchorStep: StudyStep | null = leaving.steps.has('advanced_problems')
        ? 'quiz'
        : leaving.steps.has('quiz')
          ? 'feynman'
          : null;
      const anchor = anchorStep === null ? undefined : carrierOf(topicUnits, anchorStep);
      const anchorIndex = anchor === undefined ? -1 : (dayIndex.get(anchor.date) ?? -1);
      // A quiz may share its Feynman page's day; harder problems wait a day.
      const earliest = anchorStep === 'feynman' ? anchorIndex : anchorIndex + 1;
      const home = firstFitting(leaving, Math.max(index + 1, earliest));
      if (!home) {
        if (overCards && !capNoted) {
          notes.push('Gün sınırına indirecek boş gün kalmadı; bazı görevler yerinde kaldı.');
          capNoted = true;
        } else if (overMinutes && !capacityNoted) {
          notes.push('Bazı günler kapasitesinin üstünde kaldı; taşınacak boş gün yok.');
          capacityNoted = true;
        }
        break;
      }
      moveUnit(leaving, home.date, overCards ? 'day_cap' : 'capacity');
    }
  }

  // --- Loose concept/Feynman pairs that now share a day: one learning task.
  if (groupExistingPairs) {
    for (const topicId of topics) {
      const topicUnits = byTopic.get(topicId) ?? [];
      const concept = carrierOf(topicUnits, 'concept_note');
      const feynman = carrierOf(topicUnits, 'feynman');
      if (!concept || !feynman || concept === feynman) continue;
      if (concept.date !== feynman.date) continue;
      // Only single, untouched tasks: a card that is already a group, or that
      // carries work, is left exactly as the student left it.
      if (concept.taskIds.length !== 1 || feynman.taskIds.length !== 1) continue;
      if (!concept.isMovable || !feynman.isMovable) continue;
      pairings.push({
        topicId,
        conceptTaskId: concept.taskIds[0]!,
        feynmanTaskId: feynman.taskIds[0]!,
        date: concept.date,
      });
    }
  }

  return { moves, pairings, notes };
}
