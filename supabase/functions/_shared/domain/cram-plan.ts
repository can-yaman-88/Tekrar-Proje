// The last week before an exam, planned deliberately.
//
// The weekly planner spreads the study loop over a whole term; a sprint has a
// different job. Here the only questions are which of the exam's topics are
// still weak and what fits into the evenings that are left. Everything is
// derived from state the app already has — no model is involved.
//
// Shared by the exam screen and the check-in ("vize için plan çıkar"), so the
// plan a report asks for is exactly the plan the screen would have shown.
import type { IsoDate, StudyStep, TaskType } from '../contracts/enums.contract.ts';
import { DEFAULT_DAILY_CAPACITY } from './capacity.ts';
import { addDays, diffInDays, isoWeekday } from './dates.ts';
import { bySyllabusOrder } from './syllabus-order.ts';

export interface CramTopic {
  id: string;
  title: string;
  /** Where the topic sits in the syllabus: its week, and its place within the week. */
  weekNumber: number | null;
  position: number;
  easeFactor: number;
  repetitions: number;
  nextReviewOn: IsoDate | null;
  /** Study steps already finished for this topic. */
  completedSteps: readonly StudyStep[];
  /** Tasks recently failed on this topic. */
  recentFailures: number;
}

export type Mastery = 'weak' | 'fair' | 'solid';

export interface TopicReadiness extends CramTopic {
  /** 0–100; higher means more at risk in this exam. */
  risk: number;
  mastery: Mastery;
  /** What the sprint will have them do, in order. */
  steps: StudyStep[];
}

export interface CramItem {
  topicId: string;
  topicTitle: string;
  step: StudyStep;
  type: TaskType;
  title: string;
  instructions: string;
  estimatedMinutes: number;
  dueDate: IsoDate;
}

/** One topic's share of a mixed set. */
export interface CramMixedPart {
  topicId: string;
  topicTitle: string;
  /** How the topic is named in the set's order: "A", "B", … */
  letter: string;
  problems: number;
  minutes: number;
  /** 1-based places of this topic's problems in the set ("1, 3, 6"). */
  positions: number[];
  title: string;
  instructions: string;
}

/**
 * Interleaved practice: problems from several topics in a shuffled order, so
 * each one starts with "which topic is this, which method?" — the question
 * an exam asks and a topic-by-topic session never does.
 */
export interface CramMixedSet {
  key: string;
  dueDate: IsoDate;
  title: string;
  instructions: string;
  estimatedMinutes: number;
  problems: number;
  parts: CramMixedPart[];
  /** The order the problems come in, by letter. */
  sequence: string[];
}

export interface CramDay {
  date: IsoDate;
  items: CramItem[];
  sets: CramMixedSet[];
  minutes: number;
}

export interface CramPlan {
  days: CramDay[];
  readiness: TopicReadiness[];
  /** Steps that did not fit in the days left. */
  droppedSteps: number;
  /** Every mixed set, in date order (also listed under its day). */
  mixedSets: CramMixedSet[];
  notes: string[];
}

/** Exam mode only makes sense once the exam is close. */
export const CRAM_WINDOW_DAYS = 7;
const MIN_DAILY_MINUTES = 30;
/** The evening before an exam is for recall, not new material. */
const EVE_MINUTES = 60;

/** Days before the exam that get a mixed set: one mid-sprint, one near the end. */
const MIXED_SET_OFFSETS = [4, 2] as const;
const MIXED_MIN_TOPICS = 2;
const MIXED_MAX_TOPICS = 4;
const MIXED_PROBLEM_MINUTES = 4;
const MIXED_TARGET_PROBLEMS = 12;
/** Fewer than this is not a session worth sitting down for. */
const MIXED_MIN_PROBLEMS = 6;
const MIXED_MIN_PER_TOPIC = 2;
const MIXED_WEIGHT: Record<Mastery, number> = { weak: 3, fair: 2, solid: 1 };
const LETTERS = ['A', 'B', 'C', 'D'] as const;
const LOOP_STEPS: readonly StudyStep[] = ['concept_note', 'feynman', 'quiz'];

const STEP_MINUTES: Record<StudyStep, number> = {
  concept_note: 25,
  quiz: 30,
  feynman: 25,
  advanced_problems: 40,
};

const STEP_TYPE: Record<StudyStep, TaskType> = {
  concept_note: 'concept_note',
  quiz: 'quiz',
  feynman: 'feynman',
  advanced_problems: 'advanced_problems',
};

export const MASTERY_LABEL: Record<Mastery, string> = {
  weak: 'Zayıf',
  fair: 'Orta',
  solid: 'Sağlam',
};

const STEP_COPY: Record<StudyStep, (topic: string) => { title: string; instructions: string }> = {
  concept_note: (topic) => ({
    title: `${topic} · konsept sayfası`,
    instructions: 'Sınavda lazım olacak tanımları ve formülleri tek sayfaya topla.',
  }),
  quiz: (topic) => ({
    title: `${topic} · 10 soruluk sınav`,
    instructions: 'Kendi otomasyonundan 10 soru çöz, yanlışlarını işaretle.',
  }),
  feynman: (topic) => ({
    title: `${topic} · Feynman tekrarı`,
    instructions: 'Boş kâğıda, kaynağa bakmadan baştan anlat. Takıldığın yeri not et.',
  }),
  advanced_problems: (topic) => ({
    title: `${topic} · zor sorular`,
    instructions: 'Elindeki zor soru setinden çöz; sınavın ayırt edici soruları buradan gelir.',
  }),
};

function riskOf(topic: CramTopic, examDate: IsoDate): number {
  const done = new Set(topic.completedSteps);
  let risk = 100;
  if (done.has('concept_note')) risk -= 20;
  if (done.has('quiz')) risk -= 25;
  if (done.has('feynman')) risk -= 30;
  // A low ease factor is the clearest "this one keeps slipping" signal there is.
  risk += Math.round((2.5 - topic.easeFactor) * 20);
  risk += Math.min(20, topic.recentFailures * 10);
  if (topic.nextReviewOn !== null && topic.nextReviewOn <= examDate) risk += 10;
  if (topic.repetitions === 0) risk += 5;
  return Math.max(0, Math.min(100, risk));
}

const masteryOf = (risk: number): Mastery => (risk >= 60 ? 'weak' : risk >= 30 ? 'fair' : 'solid');

/**
 * What a topic should do before the exam.
 *
 * An unfinished loop is finished (concept page → Feynman → quiz). A finished
 * one is recalled: the Feynman page always, plus a quiz when it is still shaky.
 */
function stepsFor(topic: CramTopic, risk: number): StudyStep[] {
  const done = new Set(topic.completedSteps);
  // Aynı sıra haftalık planla: konsept → Feynman → sınav.
  const missing = (['concept_note', 'feynman', 'quiz'] as const).filter((step) => !done.has(step));
  if (missing.length > 0) return missing;
  return risk >= 30 ? ['quiz', 'feynman'] : ['feynman'];
}

export interface CramPlanInput {
  today: IsoDate;
  examDate: IsoDate;
  topics: readonly CramTopic[];
  /** Minutes available per ISO weekday, as learned from real study. */
  capacityByWeekday?: Readonly<Record<number, number>>;
}

export function buildCramPlan({ today, examDate, topics, capacityByWeekday }: CramPlanInput): CramPlan {
  const notes: string[] = [];
  const readiness = topics
    .map((topic) => {
      const risk = riskOf(topic, examDate);
      return { ...topic, risk, mastery: masteryOf(risk), steps: stepsFor(topic, risk) };
    })
    // Equal risk goes in syllabus order — never alphabetical.
    .sort((a, b) => b.risk - a.risk || bySyllabusOrder(a, b));

  const daysLeft = diffInDays(today, examDate);
  if (daysLeft < 0) return { days: [], readiness, droppedSteps: 0, mixedSets: [], notes: ['Sınav geçti.'] };

  // The exam day itself is not a study day; the evening before is a short one.
  const dates: IsoDate[] = [];
  for (let offset = 0; offset < Math.max(1, daysLeft); offset++) dates.push(addDays(today, offset));
  if (dates.length === 0) dates.push(today);

  const budget = new Map<IsoDate, number>(
    dates.map((date) => {
      const learned = capacityByWeekday?.[isoWeekday(date)] ?? DEFAULT_DAILY_CAPACITY;
      // A day the student closed stays closed, sprint or not; it used to be
      // floored back up to half an hour.
      if (learned <= 0) return [date, 0];
      const isEve = date === addDays(examDate, -1);
      return [date, Math.max(MIN_DAILY_MINUTES, isEve ? Math.min(learned, EVE_MINUTES) : learned)];
    }),
  );

  const byDate = new Map<IsoDate, CramItem[]>(dates.map((date) => [date, []]));
  let dropped = 0;
  /** The day index a topic's loop is finished by: -1 when it already is. */
  const loopDoneAt = new Map<string, number>();
  const incomplete = new Set<string>();

  // Weakest topic first, and its steps in order: a topic's Feynman page can
  // never land before the quiz it is supposed to follow.
  for (const topic of readiness) {
    let earliest = 0;
    const finishingLoop = !LOOP_STEPS.every((step) => topic.completedSteps.includes(step));
    loopDoneAt.set(topic.id, -1);
    for (const step of topic.steps) {
      const minutes = STEP_MINUTES[step];
      const index = dates.findIndex((date, i) => i >= earliest && (budget.get(date) ?? 0) >= minutes);
      if (index === -1) {
        dropped++;
        if (finishingLoop) incomplete.add(topic.id);
        break;
      }
      if (finishingLoop) loopDoneAt.set(topic.id, index);
      const date = dates[index] as IsoDate;
      budget.set(date, (budget.get(date) ?? 0) - minutes);
      earliest = index;
      byDate.get(date)?.push({
        topicId: topic.id,
        topicTitle: topic.title,
        step,
        type: STEP_TYPE[step],
        estimatedMinutes: minutes,
        dueDate: date,
        ...STEP_COPY[step](topic.title),
      });
    }
  }

  const setsByDate = new Map<IsoDate, CramMixedSet[]>(dates.map((date) => [date, []]));
  const mixedSets = planMixedSets({
    examDate,
    dates,
    budget,
    readiness,
    // Ready on a day = its loop finished on an earlier day (or before the sprint).
    isReadyOn: (topicId, index) => !incomplete.has(topicId) && (loopDoneAt.get(topicId) ?? -1) < index,
    notes,
  });
  for (const set of mixedSets) setsByDate.get(set.dueDate)?.push(set);

  if (dropped > 0) {
    notes.push(`${dropped} adım kalan günlere sığmadı; en zayıf konulara öncelik verildi.`);
  }
  if (readiness.length === 0) {
    notes.push('Bu sınava bağlı konu yok. Ders sayfasından konuları sınava bağlayabilirsin.');
  }

  const days = dates.map((date) => {
    const items = byDate.get(date) ?? [];
    const sets = setsByDate.get(date) ?? [];
    return {
      date,
      items,
      sets,
      minutes:
        items.reduce((sum, item) => sum + item.estimatedMinutes, 0) +
        sets.reduce((sum, set) => sum + set.estimatedMinutes, 0),
    };
  });

  return {
    days: days.filter((day) => day.items.length > 0 || day.sets.length > 0),
    readiness,
    droppedSteps: dropped,
    mixedSets,
    notes,
  };
}

/**
 * Splits a set's problems over its topics: two each, then the rest by
 * weakness (largest remainder, ties to the weaker topic).
 */
export function allocateProblems(weights: readonly number[], total: number): number[] {
  const base = weights.map(() => MIXED_MIN_PER_TOPIC);
  let rest = total - base.length * MIXED_MIN_PER_TOPIC;
  if (rest <= 0) return base;
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const exact = weights.map((weight) => (rest * weight) / sum);
  const floors = exact.map(Math.floor);
  const result = base.map((value, i) => value + (floors[i] ?? 0));
  rest -= floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, i) => ({ i, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (let k = 0; k < rest; k++) {
    const slot = order[k % order.length];
    if (slot) result[slot.i] = (result[slot.i] ?? 0) + 1;
  }
  return result;
}

/**
 * The order a set's problems come in: each topic's problems spread evenly
 * over the whole session (the k-th of n sits near (k + ½) / n of the way
 * through), never the same topic twice in a row. Deterministic: the same plan
 * always reads the same way.
 */
export function interleave(counts: readonly number[]): number[] {
  const slots = counts
    .flatMap((count, topic) => Array.from({ length: count }, (_, k) => ({ at: (k + 0.5) / count, topic })))
    .sort((a, b) => a.at - b.at || a.topic - b.topic);
  const order = slots.map((slot) => slot.topic);
  // Even spacing can still put two of a kind side by side; swap in the next
  // different one.
  for (let i = 1; i < order.length; i++) {
    if (order[i] !== order[i - 1]) continue;
    const j = order.findIndex((topic, k) => k > i && topic !== order[i - 1]);
    if (j === -1) break;
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  return order;
}

function planMixedSets({
  examDate,
  dates,
  budget,
  readiness,
  isReadyOn,
  notes,
}: {
  examDate: IsoDate;
  dates: readonly IsoDate[];
  budget: Map<IsoDate, number>;
  readiness: readonly TopicReadiness[];
  isReadyOn: (topicId: string, dayIndex: number) => boolean;
  notes: string[];
}): CramMixedSet[] {
  const eve = addDays(examDate, -1);
  const used = new Map<string, number>();
  const taken = new Set<IsoDate>();
  const sets: CramMixedSet[] = [];
  let wanted = 0;

  for (const offset of MIXED_SET_OFFSETS) {
    const target = addDays(examDate, -offset);
    // The target day, else the day before, else the day after — never the
    // eve, never a day already holding a set.
    const candidates = [target, addDays(target, -1), addDays(target, 1)].filter(
      (date) => dates.includes(date) && date !== eve && !taken.has(date),
    );
    // A sprint that starts after this set's day is too short for it.
    if (target < (dates[0] ?? target) || candidates.length === 0) continue;
    wanted++;

    for (const date of candidates) {
      const index = dates.indexOf(date);
      const ready = readiness
        .filter((topic) => isReadyOn(topic.id, index))
        .sort(
          (a, b) =>
            (used.get(a.id) ?? 0) - (used.get(b.id) ?? 0) || b.risk - a.risk || bySyllabusOrder(a, b),
        );
      const room = Math.floor((budget.get(date) ?? 0) / MIXED_PROBLEM_MINUTES);
      const problems = Math.min(MIXED_TARGET_PROBLEMS, room);
      if (ready.length < MIXED_MIN_TOPICS || problems < MIXED_MIN_PROBLEMS) continue;

      const count = Math.min(MIXED_MAX_TOPICS, ready.length, Math.floor(problems / MIXED_MIN_PER_TOPIC));
      if (count < MIXED_MIN_TOPICS) continue;
      // Weakest first, so "A" is always the topic that needs the set most.
      const chosen = ready
        .slice(0, count)
        .sort((a, b) => b.risk - a.risk || bySyllabusOrder(a, b));
      const shares = allocateProblems(
        chosen.map((topic) => MIXED_WEIGHT[topic.mastery]),
        problems,
      );
      const order = interleave(shares);
      const sequence = order.map((i) => LETTERS[i] as string);
      const parts: CramMixedPart[] = chosen.map((topic, i) => {
        const letter = LETTERS[i] as string;
        const positions = order.flatMap((topicIndex, place) => (topicIndex === i ? [place + 1] : []));
        const n = shares[i] ?? 0;
        return {
          topicId: topic.id,
          topicTitle: topic.title,
          letter,
          problems: n,
          minutes: n * MIXED_PROBLEM_MINUTES,
          positions,
          title: `${topic.title} · karışık setten ${n} soru`,
          instructions: `Karışık setin ${letter} konusu: ${positions.join(', ')}. sorular. Kaç doğru yaptığını seti bitirince işaretle.`,
        };
      });
      const minutes = problems * MIXED_PROBLEM_MINUTES;
      const legend = parts.map((part) => `${part.letter}: ${part.topicTitle} (${part.problems})`).join(' · ');
      sets.push({
        key: `mixed:${date}`,
        dueDate: date,
        title: `Karışık tekrar · ${problems} soru · ${parts.length} konu`,
        instructions: [
          'Konular sırayla değil karışık gelir: her soruda önce hangi konudan olduğunu ve hangi yöntemi kullanacağını kendin bul — sınavda da böyle olacak.',
          legend,
          `Sıra: ${sequence.join(' ')}`,
          'Kitaba ve notlara bakmadan çöz; bitince her konu için kaç doğru yaptığını işaretle.',
        ].join('\n'),
        estimatedMinutes: minutes,
        problems,
        parts,
        sequence,
      });
      budget.set(date, (budget.get(date) ?? 0) - minutes);
      taken.add(date);
      for (const topic of chosen) used.set(topic.id, (used.get(topic.id) ?? 0) + 1);
      break;
    }
  }

  if (wanted > 0 && sets.length === 0 && readiness.length >= MIXED_MIN_TOPICS) {
    notes.push('Karışık tekrar seti için en az iki konunun döngüsü bitmiş ve günde 25 dakika yer olmalı; bu planda olmadı.');
  }
  return sets;
}
