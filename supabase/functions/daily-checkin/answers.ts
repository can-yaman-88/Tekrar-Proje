// Answers to what the report asked.
//
// "Pazarı boşalt. Yarın ne var?" is one breath, and the second half is only
// true after the first has happened. So the answer is read off the plan as it
// will stand once this check-in is applied — the tasks moved, removed, added
// and finished by it — and never written by the model, which would answer
// from the list as it was, or from nothing at all.
import type { CheckinAnswer } from '../_shared/contracts/daily-checkin.contract.ts';
import type { IsoDate, TaskSource, TaskStatus, TaskType } from '../_shared/contracts/enums.contract.ts';
import { addDays, diffInDays, isoWeekday } from '../_shared/domain/dates.ts';
import { bySyllabusOrder } from '../_shared/domain/syllabus-order.ts';
import { dayName, formatMinutes, relativeDay } from './format.ts';
import type {
  CandidateCourse,
  CandidateExam,
  CandidateMistake,
  CandidateTask,
  CandidateTopic,
  CheckinPlan,
  PlanQuestion,
} from './planner.ts';

/** A task as it will be once the check-in has been written. */
export interface ProjectedTask {
  id: string;
  title: string;
  topicId: string;
  type: TaskType;
  status: TaskStatus;
  dueDate: IsoDate;
  estimatedMinutes: number | null;
  targetCount: number | null;
  completedCount: number;
  source: TaskSource;
  parentTaskId: string | null;
  isPriority: boolean;
}

const OPEN: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['pending', 'in_progress']);
const ASSUMED_TASK_MINUTES = 30;
/** How far ahead a deadline is worth mentioning under a day's agenda. */
const DEADLINE_HORIZON_DAYS = 7;
const MAX_ITEMS = 6;

export function projectTasks(tasks: readonly CandidateTask[], plan: CheckinPlan): ProjectedTask[] {
  const removed = new Set(plan.taskRemovals.map((removal) => removal.task_id));
  const update = new Map(plan.taskUpdates.map((row) => [row.task_id, row]));
  const move = new Map(plan.taskMoves.map((row) => [row.task_id, row.due_date]));
  const edit = new Map(plan.taskEdits.map((row) => [row.task_id, row.fields]));
  const urgent = new Map(plan.priorities.map((row) => [row.task_id, row.is_priority]));

  const existing = tasks
    .filter((task) => !removed.has(task.id))
    .map((task): ProjectedTask => {
      const row = update.get(task.id);
      const fields = edit.get(task.id);
      return {
        id: task.id,
        title: fields?.title ?? task.title,
        topicId: task.topicId,
        type: fields?.type ?? task.type,
        status: row?.new_status ?? task.status,
        dueDate: move.get(task.id) ?? task.dueDate,
        estimatedMinutes: fields?.estimated_minutes ?? task.estimatedMinutes,
        targetCount: fields?.target_count ?? task.targetCount,
        completedCount: row?.completed_count ?? task.completedCount + (row?.problems_solved ?? 0),
        source: task.source,
        parentTaskId: task.parentTaskId,
        isPriority: urgent.get(task.id) ?? task.isPriority,
      };
    });
  const created = plan.newTasks.map(
    (task): ProjectedTask => ({
      id: task.id,
      title: task.title,
      topicId: task.topic_id,
      type: task.type,
      status: 'pending',
      dueDate: task.due_date,
      estimatedMinutes: task.estimated_minutes,
      targetCount: task.target_count,
      completedCount: 0,
      source: task.source,
      parentTaskId: task.parent_task_id,
      isPriority: false,
    }),
  );
  return [...existing, ...created];
}

interface Card {
  lead: ProjectedTask;
  minutes: number;
  steps: number;
}

/** One entry per piece of work the student sees: a container with its open steps, or a task alone. */
function openCards(tasks: readonly ProjectedTask[], topics: readonly CandidateTopic[]): Card[] {
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const steps = new Map<string, ProjectedTask[]>();
  for (const task of tasks) {
    if (task.parentTaskId !== null && byId.has(task.parentTaskId)) {
      steps.set(task.parentTaskId, [...(steps.get(task.parentTaskId) ?? []), task]);
    }
  }
  const cards: Card[] = [];
  for (const task of tasks) {
    if (task.parentTaskId !== null && byId.has(task.parentTaskId)) continue;
    const open = (steps.get(task.id) ?? []).filter((step) => OPEN.has(step.status));
    if (steps.has(task.id) ? open.length === 0 : !OPEN.has(task.status)) continue;
    const parts = steps.has(task.id) ? open : [task];
    cards.push({
      lead: task,
      minutes: parts.reduce((sum, part) => sum + (part.estimatedMinutes ?? ASSUMED_TASK_MINUTES), 0),
      steps: open.length,
    });
  }
  // Urgent work first within a day, as the task board shows it; then the
  // syllabus's own order — never the alphabet.
  const place = (card: Card) => topicById.get(card.lead.topicId) ?? { weekNumber: null, position: 0 };
  return cards.sort(
    (a, b) =>
      a.lead.dueDate.localeCompare(b.lead.dueDate) ||
      Number(b.lead.isPriority) - Number(a.lead.isPriority) ||
      bySyllabusOrder(place(a), place(b)),
  );
}

const isDeadlineWork = (task: ProjectedTask): boolean => task.source === 'homework' || task.source === 'ai_attachment';

const capitalise = (text: string): string => text.charAt(0).toLocaleUpperCase('tr') + text.slice(1);

export function answerQuestions({
  questions,
  logDate,
  plan,
  tasks,
  topics,
  courses,
  exams,
  openMistakes,
}: {
  questions: readonly PlanQuestion[];
  logDate: IsoDate;
  plan: CheckinPlan;
  tasks: readonly CandidateTask[];
  topics: readonly CandidateTopic[];
  courses: readonly CandidateCourse[];
  exams: readonly CandidateExam[];
  openMistakes: readonly CandidateMistake[];
}): CheckinAnswer[] {
  if (questions.length === 0) return [];
  const cards = openCards(projectTasks(tasks, plan), topics);
  const day = (date: IsoDate): string => relativeDay(date, logDate);
  const cardLine = (card: Card): string => {
    const left =
      card.lead.targetCount === null ? '' : ` · ${Math.max(0, card.lead.targetCount - card.lead.completedCount)} soru`;
    const steps = card.steps > 1 ? ` · ${card.steps} adım` : '';
    return `• ${card.lead.isPriority ? 'Acil: ' : ''}${card.lead.title}${left}${steps} · ${formatMinutes(card.minutes)}`;
  };
  const closed = new Set(plan.clearedDates);

  return questions.map((question): CheckinAnswer => {
    switch (question.kind) {
      case 'day_agenda': {
        const date = question.date ?? addDays(logDate, 1);
        const label = day(date);
        const title =
          label === dayName(date) ? `${dayName(date)} ne var?` : `${capitalise(label)} ne var? (${dayName(date)})`;
        if (closed.has(date)) return { question: title, lines: ['Bu gün boşaltıldı; üzerinde görev yok.'] };
        const due = cards.filter((card) => card.lead.dueDate === date);
        const soon = cards.filter(
          (card) =>
            isDeadlineWork(card.lead) &&
            card.lead.dueDate > date &&
            diffInDays(date, card.lead.dueDate) <= DEADLINE_HORIZON_DAYS,
        );
        const total = due.reduce((sum, card) => sum + card.minutes, 0);
        return {
          question: title,
          lines: [
            due.length === 0 ? 'Bu gün için açık görev yok.' : `${due.length} görev · ${formatMinutes(total)}`,
            ...due.slice(0, MAX_ITEMS).map(cardLine),
            ...(due.length > MAX_ITEMS ? [`…ve ${due.length - MAX_ITEMS} görev daha`] : []),
            ...soon.slice(0, 3).map((card) => `Teslimi yaklaşan: ${card.lead.title} — ${day(card.lead.dueDate)}`),
          ],
        };
      }

      case 'week_load': {
        // The ISO week the report falls in, from the report day to its Sunday.
        const sunday = addDays(logDate, 7 - isoWeekday(logDate));
        const lines: string[] = [];
        let totalCards = 0;
        let totalMinutes = 0;
        for (let date = logDate; date <= sunday; date = addDays(date, 1)) {
          const due = cards.filter((card) => card.lead.dueDate === date);
          const minutes = due.reduce((sum, card) => sum + card.minutes, 0);
          totalCards += due.length;
          totalMinutes += minutes;
          lines.push(
            closed.has(date)
              ? `${dayName(date)}: boşaltıldı`
              : `${dayName(date)}: ${due.length === 0 ? 'boş' : `${due.length} görev · ${formatMinutes(minutes)}`}`,
          );
        }
        return {
          question: 'Bu hafta ne kadar iş var?',
          lines: [`Toplam ${totalCards} görev · ${formatMinutes(Math.max(totalMinutes, 5))}`, ...lines],
        };
      }

      case 'deadlines': {
        const horizon = addDays(logDate, 14);
        const work = cards.filter((card) => isDeadlineWork(card.lead) && card.lead.dueDate <= horizon);
        return {
          question: 'Teslimi yaklaşan ödevler',
          lines:
            work.length === 0
              ? ['Önümüzdeki iki haftada teslimi olan açık ödev yok.']
              : work.slice(0, MAX_ITEMS).map((card) => {
                  const days = diffInDays(logDate, card.lead.dueDate);
                  const when = days < 0 ? `teslim tarihi geçti (${day(card.lead.dueDate)})` : `${day(card.lead.dueDate)}`;
                  return `• ${card.lead.title} — ${when} · ${formatMinutes(card.minutes)} iş`;
                }),
        };
      }

      case 'exams': {
        const courseName = new Map([
          ...topics.map((topic): [string, string] => [topic.courseId, topic.courseName]),
          ...courses.map((course): [string, string] => [course.id, course.name]),
        ]);
        const upcoming = projectExams(exams, plan)
          .filter((exam) => exam.examDate >= logDate)
          .sort((a, b) => a.examDate.localeCompare(b.examDate));
        return {
          question: 'Yaklaşan sınavlar',
          lines:
            upcoming.length === 0
              ? ['Takvimde yaklaşan sınav yok.']
              : upcoming.slice(0, MAX_ITEMS).map((exam) => {
                  const days = diffInDays(logDate, exam.examDate);
                  const course = courseName.get(exam.courseId);
                  const left = days === 0 ? 'bugün' : days === 1 ? 'yarın' : `${days} gün`;
                  return `• ${course ? `${course} · ` : ''}${exam.title} — ${dayName(exam.examDate)} · ${left}`;
                }),
        };
      }

      case 'weak_spots': {
        const resolved = new Set(plan.mistakeResolutions.map((row) => row.mistake_id));
        const entries = [
          // Tonight's still-open struggles first: they are the freshest.
          ...plan.topicMistakes
            .filter((row) => !row.resolved)
            .map((row) => ({ topicId: row.topic_id, body: row.body })),
          ...openMistakes.filter((mistake) => !resolved.has(mistake.id)),
        ];
        const topicLabel = new Map(topics.map((topic) => [topic.id, `${topic.courseName} › ${topic.title}`]));
        const byTopic = new Map<string, string[]>();
        for (const entry of entries) byTopic.set(entry.topicId, [...(byTopic.get(entry.topicId) ?? []), entry.body]);
        return {
          question: 'Zayıf noktaların',
          lines:
            byTopic.size === 0
              ? ['Hata defterinde açık madde yok.']
              : [...byTopic]
                  .sort(([, a], [, b]) => b.length - a.length)
                  .slice(0, MAX_ITEMS)
                  .map(([topicId, bodies]) => {
                    const more = bodies.length > 1 ? ` (+${bodies.length - 1})` : '';
                    return `• ${topicLabel.get(topicId) ?? 'Konu'}: "${bodies[0]}"${more}`;
                  }),
        };
      }

      case 'overdue': {
        const late = cards.filter((card) => card.lead.dueDate < logDate);
        const minutes = late.reduce((sum, card) => sum + card.minutes, 0);
        return {
          question: 'Geride kalan işler',
          lines:
            late.length === 0
              ? ['Son iki haftadan açık kalan iş yok.']
              : [
                  `${late.length} görev · ${formatMinutes(minutes)}`,
                  ...late.slice(0, MAX_ITEMS).map((card) => `• ${card.lead.title} — ${day(card.lead.dueDate)}`),
                  'Görevler ekranındaki "geciken" listesinden dağıtabilir ya da kapatabilirsin.',
                ],
        };
      }
    }
  });
}

/** The exam calendar as this check-in leaves it. */
function projectExams(exams: readonly CandidateExam[], plan: CheckinPlan): CandidateExam[] {
  const deleted = new Set(plan.examChanges.filter((c) => c.action === 'delete').map((c) => c.exam_id));
  const updated = new Map(plan.examChanges.filter((c) => c.action === 'update').map((c) => [c.exam_id, c]));
  const kept = exams
    .filter((exam) => !deleted.has(exam.id))
    .map((exam) => {
      const change = updated.get(exam.id);
      return { ...exam, title: change?.title ?? exam.title, examDate: change?.exam_date ?? exam.examDate };
    });
  const inserted = plan.examChanges.flatMap((change, index) =>
    change.action === 'insert' && change.course_id !== null && change.exam_date !== null
      ? [{ id: `new-${index}`, courseId: change.course_id, title: change.title ?? 'Sınav', examDate: change.exam_date }]
      : [],
  );
  return [...kept, ...inserted];
}
