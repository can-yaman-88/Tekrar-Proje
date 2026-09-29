// What the report was read as, one line per change.
//
// The result screen used to say "3 görev güncellendi, 2 eklendi" — true, and
// no help at all when the model had put "Carnot'ta takıldım" on the Gauss set.
// A misread is only caught if it is shown, so every change is spelled out in
// the student's terms: which task, what happened to it, which day it went to.
// The lines are written from the plan, never by the model: what the list says
// is what the database is told.
import type { CheckinChange, CheckinChangeKind } from '../_shared/contracts/daily-checkin.contract.ts';
import type { IsoDate } from '../_shared/contracts/enums.contract.ts';
import { isoWeekday } from '../_shared/domain/dates.ts';
import { dayName, relativeDay, weekdayName } from './format.ts';
import type { CandidateCourse, CandidateExam, CandidateTask, CandidateTopic, CheckinPlan } from './planner.ts';

/** Past this, a list of moves reads better as a count per day. */
const MAX_ITEMISED = 6;
/** A screen, not a log. */
const MAX_LINES = 30;

const FIELD_LABEL: Record<string, (value: unknown) => string> = {
  title: (value) => `adı "${String(value)}"`,
  instructions: () => 'yönergesi',
  type: () => 'türü',
  target_count: (value) => `${String(value)} soru`,
  estimated_minutes: (value) => `~${String(value)} dk`,
  starts_on: (value) => `başlangıç ${dayName(String(value))}`,
  day_allocations: () => 'gün payları',
};

export function describePlan({
  plan,
  logDate,
  tasks,
  topics,
  courses,
  exams,
}: {
  plan: CheckinPlan;
  logDate: IsoDate;
  tasks: readonly CandidateTask[];
  topics: readonly CandidateTopic[];
  courses: readonly CandidateCourse[];
  exams: readonly CandidateExam[];
}): CheckinChange[] {
  const changes: CheckinChange[] = [];
  const add = (kind: CheckinChangeKind, text: string): void => {
    changes.push({ kind, text });
  };

  const titleOf = new Map<string, string>([
    ...tasks.map((task): [string, string] => [task.id, task.title]),
    ...plan.newTasks.map((task): [string, string] => [task.id, task.title]),
  ]);
  const quoted = (taskId: string): string => `"${titleOf.get(taskId) ?? 'görev'}"`;
  const day = (date: IsoDate): string => relativeDay(date, logDate);
  const courseName = new Map<string, string>([
    ...topics.map((topic): [string, string] => [topic.courseId, topic.courseName]),
    ...courses.map((course): [string, string] => [course.id, course.name]),
  ]);

  // --- What happened to existing work.
  const bulk = new Set(plan.schedule.bulkCompletedTaskIds);
  if (bulk.size > 0) {
    const days = [...new Set([...bulk].map((id) => tasks.find((task) => task.id === id)?.dueDate ?? logDate))];
    add('done', `${days.map(day).join(', ')}: ${bulk.size} görevin hepsi tamamlandı.`);
  }

  const followUp = new Map(
    plan.newTasks.filter((task) => task.rescheduled_from_task_id !== null).map((task) => [task.rescheduled_from_task_id, task]),
  );
  for (const update of plan.taskUpdates) {
    if (bulk.has(update.task_id)) continue;
    const name = quoted(update.task_id);
    const next = followUp.get(update.task_id);
    if (update.completed_count !== null) {
      add('edited', `${name}: önceki rapor düzeltildi, toplam ${update.completed_count}.`);
      continue;
    }
    switch (update.new_status) {
      case 'completed':
        add('done', `${name} tamamlandı${update.correct_count === null ? '' : ` · ${update.correct_count} doğru`}.`);
        if (next) add('added', `İsabet düşük: "${next.title}" ${day(next.due_date)} için eklendi.`);
        break;
      case 'in_progress':
        add(
          'progress',
          update.problems_solved === null ? `${name} devam ediyor.` : `${name}: ${update.problems_solved} soru ilerledi.`,
        );
        break;
      case 'failed':
        add('struggle', `${name}: takıldın${next ? `; telafi görevi ${day(next.due_date)} için eklendi` : ''}.`);
        break;
      case 'rescheduled':
        add('moved', `${name} yapılamadı${next ? `; ${day(next.due_date)} yeniden planlandı` : ''}.`);
        break;
      case 'pending':
        add('edited', `${name} yapılmadı olarak düzeltildi.`);
        break;
      default:
        break;
    }
  }

  // --- Study outside the plan.
  for (const work of plan.extraWork) {
    const topic = topics.find((candidate) => candidate.id === work.topic_id)?.title ?? 'konu';
    const parts = [
      work.target_count === null ? null : `${work.target_count} soru`,
      work.correct_count === null ? null : `${work.correct_count} doğru`,
      work.session_minutes === null ? null : `${work.session_minutes} dk`,
    ].filter((part): part is string => part !== null);
    add('done', `Ek çalışma kaydedildi: ${topic}${parts.length > 0 ? ` — ${parts.join(' · ')}` : ''} (${day(work.on_date)}).`);
  }

  // --- New work. Retries were named with the task they retry; steps are
  // counted under their parent; a group's container is told with its group;
  // a sprint is told as one line below.
  const groupParents = new Set(plan.taskGroups.map((group) => group.parent_task_id));
  const stepCount = new Map<string, number>();
  for (const task of plan.newTasks) {
    if (task.parent_task_id !== null) stepCount.set(task.parent_task_id, (stepCount.get(task.parent_task_id) ?? 0) + 1);
  }
  for (const task of plan.newTasks) {
    if (task.rescheduled_from_task_id !== null || task.parent_task_id !== null || groupParents.has(task.id)) continue;
    if (task.source === 'exam_cram') continue;
    const steps = stepCount.get(task.id) ?? 0;
    const tail = steps > 0 ? ` (${steps} adım)` : '';
    switch (task.source) {
      case 'homework':
        add('added', `Ödev eklendi: "${task.title}" — teslim ${day(task.due_date)}${tail}.`);
        break;
      case 'manual':
        add('added', `Eklendi: "${task.title}" — ${day(task.due_date)}${tail}.`);
        break;
      case 'ai_attachment':
        add('added', `Dosyadan: "${task.title}" — ${day(task.due_date)}.`);
        break;
      default:
        add('added', `Zayıf nokta çalışması: "${task.title}" — ${day(task.due_date)}.`);
    }
  }
  // Steps added to a task that already existed ("fizik ödevini üç adıma böl").
  for (const [parentId, count] of stepCount) {
    if (!plan.newTasks.some((task) => task.id === parentId)) add('edited', `${quoted(parentId)} ${count} adıma bölündü.`);
  }

  if (plan.taskRemovals.length > MAX_ITEMISED) {
    add('removed', `${plan.taskRemovals.length} görev kaldırıldı.`);
  } else {
    for (const removal of plan.taskRemovals) add('removed', `${quoted(removal.task_id)} kaldırıldı.`);
  }

  // --- Days and the shape of the coming week.
  for (const date of plan.schedule.missedDates) {
    add('moved', `${day(date)} yapılamayan işler sonraki günlere dağıtıldı.`);
  }
  const everyWeek = new Set(plan.blockWeekdays);
  const cleared = plan.clearedDates.filter((date) => !everyWeek.has(isoWeekday(date)));
  if (cleared.length > 0) add('calendar', `Boşaltıldı: ${cleared.map(day).join(', ')}.`);
  for (const weekday of plan.blockWeekdays) {
    add('calendar', `${weekdayName(weekday)} günleri artık kapalı; plan o güne iş koymayacak.`);
  }
  for (const weekday of plan.reopenWeekdays) add('calendar', `${weekdayName(weekday)} günleri yeniden açık.`);
  for (const budget of plan.schedule.dayBudgets) {
    add('calendar', `${day(budget.date)} için ~${budget.minutes} dk sınır; sığmayan işler taşındı.`);
  }
  for (const hold of plan.schedule.holds) {
    const names = hold.courseIds.map((id) => courseName.get(id) ?? 'ders').join(', ');
    const span = hold.from === hold.until ? day(hold.from) : `${day(hold.from)} – ${day(hold.until)}`;
    add('calendar', hold.mode === 'pause' ? `${names} beklemede: ${span}.` : `${span}: yalnızca ${names}.`);
  }

  for (const swap of plan.schedule.swaps) {
    add('moved', `${day(swap.first)} ile ${day(swap.second)} görevleri yer değiştirdi.`);
  }
  for (const order of plan.schedule.syllabusOrders) {
    add(
      'moved',
      order.moved === 0
        ? `${day(order.from)} – ${day(order.until)} zaten konu sırasındaydı.`
        : `${day(order.from)} – ${day(order.until)} konu sırasına dizildi; günlerdeki görev sayısı aynı kaldı.`,
    );
  }
  for (const tidy of plan.schedule.tidies) {
    add(
      'moved',
      `${day(tidy.from)} – ${day(tidy.until)} düzenlendi${tidy.paired > 0 ? `; ${tidy.paired} konu tek öğrenme kartına toplandı` : ''}.`,
    );
  }
  for (const entry of plan.schedule.backlog) {
    add(
      entry.action === 'spread' ? 'moved' : 'removed',
      entry.tasks === 0
        ? 'Geciken iş yoktu.'
        : entry.action === 'spread'
          ? `${entry.tasks} geciken iş önümüzdeki günlere dağıtıldı.`
          : `${entry.tasks} geciken iş kapatıldı.`,
    );
  }

  // A card moves as one: its steps are not listed beside it.
  const movedIds = new Set(plan.taskMoves.map((move) => move.task_id));
  const parentOf = new Map(tasks.map((task) => [task.id, task.parentTaskId]));
  const moves = plan.taskMoves.filter((move) => {
    const parent = parentOf.get(move.task_id);
    return parent === null || parent === undefined || !movedIds.has(parent);
  });
  if (moves.length > MAX_ITEMISED) {
    const perDay = new Map<IsoDate, number>();
    for (const move of moves) perDay.set(move.due_date, (perDay.get(move.due_date) ?? 0) + 1);
    const spread = [...perDay]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => `${day(date)} ${count}`)
      .join(', ');
    add('moved', `${moves.length} görev başka günlere alındı (${spread}).`);
  } else {
    for (const move of moves) add('moved', `${quoted(move.task_id)} → ${day(move.due_date)}.`);
  }

  // --- Everything the student could have changed by hand.
  for (const edit of plan.taskEdits) {
    const parts = Object.entries(edit.fields).map(([field, value]) => FIELD_LABEL[field]?.(value) ?? field);
    add('edited', `${quoted(edit.task_id)} güncellendi: ${parts.join(', ')}.`);
  }
  for (const group of plan.taskGroups) {
    const container = plan.newTasks.find((task) => task.id === group.parent_task_id);
    add(
      'edited',
      container?.type === 'learning'
        ? `Konsept ve Feynman tek öğrenme kartında: ${quoted(group.parent_task_id)} — ${day(container.due_date)}.`
        : `${group.child_task_ids.length} görev ${quoted(group.parent_task_id)} altında toplandı.`,
    );
  }
  for (const containerId of plan.taskUngroups) {
    add('edited', `${quoted(containerId)} grubu dağıtıldı; adımları ayrı görev oldu.`);
  }
  for (const note of plan.taskNotes) add('edited', `${quoted(note.task_id)} için not eklendi.`);
  for (const log of plan.timeLogs) add('progress', `${quoted(log.task_id)}: ${log.minutes} dk kaydedildi.`);

  const examTitle = new Map(exams.map((exam) => [exam.id, exam.title]));
  for (const change of plan.examChanges) {
    const title = change.title ?? (change.exam_id ? examTitle.get(change.exam_id) : null) ?? 'Sınav';
    if (change.action === 'insert') {
      add('calendar', `Sınav eklendi: ${title} — ${change.exam_date ? dayName(change.exam_date) : 'tarihsiz'}.`);
    } else if (change.action === 'delete') {
      add('calendar', `Sınav silindi: ${title}.`);
    } else {
      add('calendar', `${title} güncellendi${change.exam_date ? `: ${dayName(change.exam_date)}` : ''}.`);
    }
  }

  for (const scope of plan.examScopes) {
    const title = examTitle.get(scope.exam_id) ?? 'Sınav';
    add(
      'calendar',
      scope.replace
        ? `${title} artık ${scope.topic_ids.length} konuyu kapsıyor.`
        : `${title} kapsamına ${scope.topic_ids.length} konu eklendi.`,
    );
  }
  for (const result of plan.examResults) {
    const title = examTitle.get(result.exam_id) ?? 'Sınav';
    add(
      'calendar',
      `${title}: sonuç kaydedildi${result.note ? ` (${result.note})` : ''}; kapsadığı konuların tekrar takvimi güncellendi.`,
    );
  }
  for (const sprint of plan.schedule.examPlans) {
    const title = examTitle.get(sprint.examId) ?? 'Sınav';
    add(
      'added',
      sprint.tasks === 0
        ? `${title} için eklenecek adım çıkmadı.`
        : `${title} için sınav planı: ${sprint.tasks} adım, ${sprint.days} güne yayıldı.`,
    );
  }
  for (const flag of plan.priorities) {
    add('edited', `${quoted(flag.task_id)} ${flag.is_priority ? 'acil olarak işaretlendi' : 'artık acil değil'}.`);
  }
  for (const reminder of plan.reminders) {
    add('calendar', `Hatırlatma: ${day(reminder.date)} ${reminder.time.replace(':', '.')} — ${reminder.text}`);
  }

  if (plan.mistakeResolutions.length > 0) {
    add('done', `${plan.mistakeResolutions.length} hata defteri maddesi kapatıldı.`);
  }
  const topicTitle = new Map(topics.map((topic) => [topic.id, topic.title]));
  for (const flag of plan.topicFlags) {
    const topic = topicTitle.get(flag.topic_id) ?? 'konu';
    add('edited', `${topic}: ileri seviye sorular ${flag.has_advanced_material ? 'açıldı' : 'kapatıldı'}.`);
  }

  for (const note of plan.notes) add('warning', note);

  if (changes.length <= MAX_LINES) return changes;
  return [
    ...changes.slice(0, MAX_LINES - 1),
    { kind: 'warning', text: `…ve ${changes.length - (MAX_LINES - 1)} değişiklik daha (Geçmiş → Değerlendirmeler).` },
  ];
}

