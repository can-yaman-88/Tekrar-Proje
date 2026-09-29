import { assertEquals } from 'jsr:@std/assert@1';
import type { CheckinExtraction } from '../_shared/contracts/daily-checkin.contract.ts';
import { type CandidateTask, type CandidateTopic, planCheckinEffects } from './planner.ts';

const TODAY = '2026-10-05';
const srs = { easeFactor: 2.5, intervalDays: 6, repetitions: 2 };

const topics: CandidateTopic[] = [
  { id: 'top-truss', courseId: 'c-statics', title: 'Trusses', courseName: 'Statics', weekNumber: 1, position: 0, srs },
  { id: 'top-carnot', courseId: 'c-thermo', title: 'Carnot cycle', courseName: 'Thermodynamics', weekNumber: 2, position: 0, srs },
  { id: 'top-gauss', courseId: 'c-phys', title: "Gauss's law", courseName: 'Physics 2', weekNumber: 2, position: 0, srs },
];

const task = (id: string, topicId: string, over: Partial<CandidateTask> = {}): CandidateTask => ({
  id,
  topicId,
  title: `Task ${id}`,
  type: 'problem_set',
  status: 'pending',
  dueDate: TODAY,
  targetCount: 30,
  completedCount: 0,
  estimatedMinutes: 90,
  instructions: null,
  source: 'ai_weekly_plan',
  parentTaskId: null,
  originExamId: null,
  isPriority: false,
  ...over,
});

const tasks = [task('t-truss', 'top-truss'), task('t-carnot', 'top-carnot', { targetCount: 10 })];

type Outcome = CheckinExtraction['taskOutcomes'][number];
const outcome = (over: Partial<Outcome> & Pick<Outcome, 'taskId' | 'outcome'>): Outcome => ({
  problemsSolved: null,
  correctCount: null,
  weakDetail: null,
  weakResolved: false,
  confidence: null,
  weakConcept: null,
  daysAgo: null,
  correctsEarlierReport: false,
  ...over,
});

const extraction = (over: Partial<CheckinExtraction>): CheckinExtraction => ({
  summary: 'ok',
  taskOutcomes: [],
  bulkOutcomes: [],
  topicStruggles: [],
  unmatchedMentions: [],
  attachmentTasks: [],
  advancedMaterialTopics: [],
  taskRemovals: [],
  plannedWork: [],
  taskBreakdowns: [],
  dayClearances: [],
  reopenedWeekdays: [],
  dayLoads: [],
  courseHolds: [],
  dayTargets: [],
  taskReschedules: [],
  taskEdits: [],
  taskGroups: [],
  taskNotes: [],
  timeLogs: [],
  examChanges: [],
  mistakeResolutions: [],
  extraWork: [],
  examResults: [],
  priorities: [],
  examPlans: [],
  reminders: [],
  undoPreviousReport: false,
  taskUngroups: [],
  daySwaps: [],
  syllabusOrders: [],
  weekTidies: [],
  backlogActions: [],
  examScopes: [],
  infoRequests: [],
  ...over,
});

Deno.test('completed + failed: statuses, SM-2 and a remedial retry task', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskOutcomes: [
        { taskId: 't-truss', outcome: 'completed', correctCount: null, weakDetail: null, weakResolved: false, problemsSolved: null, confidence: 4, weakConcept: null , daysAgo: null, correctsEarlierReport: false },
        { taskId: 't-carnot', outcome: 'failed', correctCount: null, weakDetail: null, weakResolved: false, problemsSolved: 3, confidence: 2, weakConcept: 'Carnot efficiency' , daysAgo: null, correctsEarlierReport: false },
      ],
    }),
  });

  assertEquals(plan.taskUpdates.map((u) => [u.task_id, u.new_status, u.problems_solved]), [
    ['t-truss', 'completed', 30],
    ['t-carnot', 'failed', 3],
  ]);
  const truss = plan.topicReviews.find((r) => r.topic_id === 'top-truss');
  assertEquals(truss?.repetitions, 3);
  assertEquals(truss?.interval_days, 15); // I(n) = I(n-1) × EF(previous) = 6 × 2.5
  const carnot = plan.topicReviews.find((r) => r.topic_id === 'top-carnot');
  assertEquals([carnot?.repetitions, carnot?.interval_days, carnot?.next_review_on], [0, 1, '2026-10-06']);

  assertEquals(plan.newTasks.length, 1);
  assertEquals(plan.newTasks[0]?.rescheduled_from_task_id, 't-carnot');
  assertEquals(plan.newTasks[0]?.target_count, 7);
  assertEquals(plan.newTasks[0]?.due_date, '2026-10-06');
});

Deno.test('hallucinated ids are dropped, duplicates ignored', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskOutcomes: [
        { taskId: 'made-up', outcome: 'completed', correctCount: null, weakDetail: null, weakResolved: false, problemsSolved: null, confidence: null, weakConcept: null , daysAgo: null, correctsEarlierReport: false },
        { taskId: 't-truss', outcome: 'partial', correctCount: null, weakDetail: null, weakResolved: false, problemsSolved: 10, confidence: null, weakConcept: null , daysAgo: null, correctsEarlierReport: false },
        { taskId: 't-truss', outcome: 'completed', correctCount: null, weakDetail: null, weakResolved: false, problemsSolved: null, confidence: null, weakConcept: null , daysAgo: null, correctsEarlierReport: false },
      ],
      topicStruggles: [{ topicId: 'nope', concept: 'x', detail: null, resolved: false, confidence: 1, daysAgo: null }],
    }),
  });
  assertEquals(plan.droppedReferences, 2);
  assertEquals(plan.taskUpdates.map((u) => u.new_status), ['in_progress']);
  assertEquals(plan.topicReviews, []);
});

Deno.test('partial that covers the remainder is promoted to completed', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [task('t', 'top-truss', { completedCount: 25 })],
    topics,
    extraction: extraction({
      taskOutcomes: [{ taskId: 't', outcome: 'partial', correctCount: null, weakDetail: null, weakResolved: false, problemsSolved: 5, confidence: null, weakConcept: null , daysAgo: null, correctsEarlierReport: false }],
    }),
  });
  assertEquals(plan.taskUpdates[0]?.new_status, 'completed');
});

Deno.test('not_attempted: overdue is rescheduled, future task untouched', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [task('due', 'top-truss'), task('future', 'top-gauss', { dueDate: '2026-10-07' })],
    topics,
    extraction: extraction({
      taskOutcomes: [
        { taskId: 'due', outcome: 'not_attempted', correctCount: null, weakDetail: null, weakResolved: false, problemsSolved: null, confidence: null, weakConcept: null , daysAgo: null, correctsEarlierReport: false },
        { taskId: 'future', outcome: 'not_attempted', correctCount: null, weakDetail: null, weakResolved: false, problemsSolved: null, confidence: null, weakConcept: null , daysAgo: null, correctsEarlierReport: false },
      ],
    }),
  });
  assertEquals(plan.taskUpdates.map((u) => [u.task_id, u.new_status]), [['due', 'rescheduled']]);
  assertEquals(plan.newTasks.map((t) => t.rescheduled_from_task_id), ['due']);
});

Deno.test('topic struggles create one drill per topic and spread load across days', () => {
  const many = Array.from({ length: 5 }, (_, i) => task(`f${i}`, i % 2 ? 'top-truss' : 'top-gauss'));
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: many,
    topics,
    extraction: extraction({
      taskOutcomes: many.map((t) => outcome({ taskId: t.id, outcome: 'not_attempted' })),
      topicStruggles: [
        { topicId: 'top-carnot', concept: 'Carnot cycle', detail: null, resolved: false, confidence: null, daysAgo: null },
        { topicId: 'top-carnot', concept: 'again', detail: null, resolved: false, confidence: null, daysAgo: null },
      ],
    }),
  });
  assertEquals(plan.newTasks.length, 6);
  assertEquals(plan.newTasks.map((t) => t.due_date), [
    '2026-10-06', '2026-10-06', '2026-10-06', '2026-10-07', '2026-10-07', '2026-10-07',
  ]);
  assertEquals(plan.newTasks.filter((t) => t.type === 'spaced_review').length, 1);
});

Deno.test('out-of-range model values are clamped, not rejected', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskOutcomes: [
        { taskId: 't-truss', outcome: 'completed', correctCount: null, weakDetail: null, weakResolved: false, problemsSolved: 999_999, confidence: 9, weakConcept: null , daysAgo: null, correctsEarlierReport: false },
        { taskId: 't-carnot', outcome: 'failed', correctCount: null, weakDetail: null, weakResolved: false, problemsSolved: -5, confidence: 0, weakConcept: null , daysAgo: null, correctsEarlierReport: false },
      ],
    }),
  });
  assertEquals(plan.taskUpdates[0]?.problems_solved, 9_999);
  assertEquals(plan.taskUpdates[0]?.confidence_level, 5);
  assertEquals(plan.taskUpdates[1]?.problems_solved, 0);
  assertEquals(plan.taskUpdates[1]?.confidence_level, 1);
});

Deno.test('partial work with low confidence is treated as failed and gets a retry', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskOutcomes: [
        { taskId: 't-carnot', outcome: 'partial', correctCount: null, weakDetail: null, weakResolved: false, problemsSolved: 3, confidence: 1, weakConcept: 'verim türetmesi' , daysAgo: null, correctsEarlierReport: false },
      ],
    }),
  });
  assertEquals(plan.taskUpdates[0]?.new_status, 'failed');
  assertEquals(plan.newTasks[0]?.target_count, 7);
  assertEquals(plan.topicReviews[0]?.interval_days, 1);
});

Deno.test('partial work with decent confidence stays in progress', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskOutcomes: [{ taskId: 't-carnot', outcome: 'partial', correctCount: null, weakDetail: null, weakResolved: false, problemsSolved: 3, confidence: 4, weakConcept: null , daysAgo: null, correctsEarlierReport: false }],
    }),
  });
  assertEquals(plan.taskUpdates[0]?.new_status, 'in_progress');
  assertEquals(plan.newTasks, []);
});

Deno.test('correction re-opens a completed task and sets the total', () => {
  const done = task('t-done', 'top-truss', { status: 'completed', completedCount: 30, targetCount: 30 });
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [done],
    topics,
    extraction: extraction({
      taskOutcomes: [
        outcome({ taskId: 't-done', outcome: 'partial', correctCount: null, weakDetail: null, weakResolved: false, problemsSolved: 20, correctsEarlierReport: true }),
      ],
    }),
  });
  assertEquals(plan.taskUpdates[0]?.new_status, 'in_progress');
  assertEquals(plan.taskUpdates[0]?.completed_count, 20); // absolute, not +20
  assertEquals(plan.taskUpdates[0]?.problems_solved, null);
  assertEquals(plan.newTasks, []); // a correction creates no follow-up work
});

Deno.test('correction that still meets the target keeps the task completed', () => {
  const done = task('t-done', 'top-truss', { status: 'completed', completedCount: 30, targetCount: 20 });
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [done],
    topics,
    extraction: extraction({
      taskOutcomes: [
        outcome({ taskId: 't-done', outcome: 'completed', correctCount: null, weakDetail: null, weakResolved: false, problemsSolved: 25, correctsEarlierReport: true, confidence: 4 }),
      ],
    }),
  });
  assertEquals(plan.taskUpdates[0]?.new_status, 'completed');
  assertEquals(plan.taskUpdates[0]?.completed_count, 25);
});

Deno.test('correction to "did not do it" resets the task to pending', () => {
  const done = task('t-done', 'top-carnot', { status: 'completed', completedCount: 10, targetCount: 10 });
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [done],
    topics,
    extraction: extraction({
      taskOutcomes: [outcome({ taskId: 't-done', outcome: 'not_attempted', correctCount: null, weakDetail: null, weakResolved: false, correctsEarlierReport: true })],
    }),
  });
  assertEquals(plan.taskUpdates[0]?.new_status, 'pending');
  assertEquals(plan.taskUpdates[0]?.completed_count, 10);
});

Deno.test('a homework attachment becomes a task on its topic', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [],
    topics,
    extraction: extraction({
      attachmentTasks: [
        {
          topicId: 'top-truss',
          title: 'Ödev 3: 1-8 arası soruları çöz',
          type: 'problem_set',
          problemCount: 8,
          dueDate: '2026-10-12',
          instructions: 'Önce serbest cisim diyagramını çiz.',
        },
        {
          topicId: 'top-gauss',
          title: 'Lab ön hazırlığı',
          type: 'concept_review',
          problemCount: null,
          dueDate: null,
          instructions: null,
        },
        { topicId: 'yok', title: 'hayali', type: 'problem_set', problemCount: 3, dueDate: null, instructions: null },
      ],
    }),
  });

  assertEquals(plan.newTasks.length, 2);
  const homework = plan.newTasks[0];
  assertEquals(homework?.source, 'ai_attachment');
  assertEquals(homework?.due_date, '2026-10-12'); // the deadline stated in the file
  assertEquals(homework?.target_count, 8);
  // No deadline in the file → scheduled by the app.
  assertEquals(plan.newTasks[1]?.due_date, '2026-10-06');
  assertEquals(plan.droppedReferences, 1);
});

Deno.test('an implausible attachment deadline is replaced by the app schedule', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [],
    topics,
    extraction: extraction({
      attachmentTasks: [
        {
          topicId: 'top-truss',
          title: 'Geçmiş tarihli ödev',
          type: 'problem_set',
          problemCount: 5,
          dueDate: '2019-01-01',
          instructions: null,
        },
      ],
    }),
  });
  assertEquals(plan.newTasks[0]?.due_date, '2026-10-06');
});

Deno.test('ileri seviye materyal bayrağı yalnızca bilinen konular için taşınır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [],
    topics,
    extraction: extraction({
      advancedMaterialTopics: [
        { topicId: 'top-truss', hasAdvancedMaterial: true },
        { topicId: 'top-truss', hasAdvancedMaterial: false },
        { topicId: 'bilinmeyen', hasAdvancedMaterial: true },
      ],
    }),
  });
  assertEquals(plan.topicFlags, [{ topic_id: 'top-truss', has_advanced_material: true }]);
  assertEquals(plan.droppedReferences, 1);
});

Deno.test('birkaç günü kapsayan rapor: tekrar tarihi işin yapıldığı güne göre kurulur', () => {
  const plan = planCheckinEffects({
    logDate: TODAY, // 2026-10-05
    tasks: [task('t-truss', 'top-truss'), task('t-carnot', 'top-carnot', { targetCount: 10 })],
    topics,
    extraction: extraction({
      taskOutcomes: [
        // Pazartesi (3 gün önce) kafesler bitti, dün Carnot'ta takıldı.
        outcome({ taskId: 't-truss', outcome: 'completed', correctCount: null, weakDetail: null, weakResolved: false, confidence: 5, daysAgo: 3 }),
        outcome({ taskId: 't-carnot', outcome: 'failed', correctCount: null, weakDetail: null, weakResolved: false, confidence: 1, daysAgo: 1 }),
      ],
    }),
  });

  assertEquals(plan.coveredDates, ['2026-10-02', '2026-10-04']);
  const truss = plan.topicReviews.find((r) => r.topic_id === 'top-truss');
  // 3 tekrar → 6 × 2.5 = 15 gün, 2 Ekim'den itibaren.
  assertEquals(truss?.next_review_on, '2026-10-17');
});

Deno.test('geçmişte kalan tekrar tarihi bugüne çekilir', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [task('t-carnot', 'top-carnot')],
    topics,
    extraction: extraction({
      // Beş gün önce takılmış: 1 günlük aralık bugünden önceye düşerdi.
      taskOutcomes: [outcome({ taskId: 't-carnot', outcome: 'failed', correctCount: null, weakDetail: null, weakResolved: false, confidence: 1, daysAgo: 5 })],
    }),
  });
  assertEquals(plan.topicReviews[0]?.next_review_on, TODAY);
});

Deno.test('gün belirtilmemişse her şey rapor gününe yazılır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [task('t-truss', 'top-truss')],
    topics,
    extraction: extraction({
      taskOutcomes: [outcome({ taskId: 't-truss', outcome: 'completed', correctCount: null, weakDetail: null, weakResolved: false, confidence: 4 })],
    }),
  });
  assertEquals(plan.coveredDates, [TODAY]);
});

// ---------------------------------------------------------------------------
// Removals and work the report itself describes.
// ---------------------------------------------------------------------------
Deno.test('silme isteği görevleri kaldırma listesine koyar', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskRemovals: [{ taskId: 't-truss', reason: 'ilk hafta işlenmedi' }],
    }),
  });

  assertEquals(plan.taskRemovals, [{ task_id: 't-truss', reason: 'ilk hafta işlenmedi' }]);
  assertEquals(plan.newTasks.length, 0);
});

Deno.test('olmayan görev silinmeye çalışılırsa sessizce düşer', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({ taskRemovals: [{ taskId: 'uydurma-id', reason: null }] }),
  });

  assertEquals(plan.taskRemovals, []);
  assertEquals(plan.droppedReferences, 1);
});

Deno.test('raporda anlatılan çalışma, tarihiyle birlikte göreve dönüşür', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      plannedWork: [
        {
          topicId: 'top-gauss',
          title: 'Fizik ödevi',
          type: 'problem_set',
          problemCount: 8,
          dueInDays: 2,
          isHomework: true,
          dueDate: null,
          instructions: null,
          subtasks: [],
          replacesTaskIds: [],
        },
      ],
    }),
  });

  assertEquals(plan.newTasks.length, 1);
  assertEquals(plan.newTasks[0]?.title, 'Fizik ödevi');
  assertEquals(plan.newTasks[0]?.due_date, '2026-10-07');
  assertEquals(plan.newTasks[0]?.source, 'homework');
  assertEquals(plan.newTasks[0]?.target_count, 8);
});

Deno.test('"bu ödev şu görevleri karşılar": yerine geçtiği görevler kaldırılır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      plannedWork: [
        {
          topicId: null, // ders belli, konu değil: yerine geçtiği görevden alınır
          title: 'İngilizce ödevi',
          type: 'problem_set',
          problemCount: null,
          dueInDays: 1,
          isHomework: true,
          dueDate: null,
          instructions: null,
          subtasks: [],
          replacesTaskIds: ['t-truss', 't-carnot'],
        },
      ],
    }),
  });

  assertEquals(plan.taskRemovals.map((r) => r.task_id).sort(), ['t-carnot', 't-truss']);
  assertEquals(plan.newTasks.length, 1);
  assertEquals(plan.newTasks[0]?.topic_id, 'top-truss'); // ilk karşılanan görevin konusu
  assertEquals(plan.newTasks[0]?.due_date, '2026-10-06');
});

Deno.test('yapıldığı bildirilen görev aynı raporda silinmez', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskOutcomes: [outcome({ taskId: 't-truss', outcome: 'completed' })],
      taskRemovals: [{ taskId: 't-truss', reason: 'sil' }],
    }),
  });

  assertEquals(plan.taskRemovals, []);
  assertEquals(plan.taskUpdates[0]?.new_status, 'completed');
});

Deno.test('tarihsiz ödev de sıraya girer, gelecekteki bir güne düşer', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      plannedWork: [
        {
          topicId: 'top-gauss',
          title: 'Tarihsiz ödev',
          type: 'problem_set',
          problemCount: null,
          dueInDays: null,
          isHomework: true,
          dueDate: null,
          instructions: null,
          subtasks: [],
          replacesTaskIds: [],
        },
      ],
    }),
  });

  assertEquals(plan.newTasks.length, 1);
  assertEquals((plan.newTasks[0]?.due_date ?? '') > TODAY, true);
});

// ---------------------------------------------------------------------------
// Accuracy: what was right, not just what was done.
// ---------------------------------------------------------------------------
Deno.test('düşük isabet, görev bitmiş olsa bile konuyu zayıf sayar', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskOutcomes: [
        outcome({ taskId: 't-carnot', outcome: 'completed', problemsSolved: 10, correctCount: 4, confidence: 5 }),
      ],
    }),
  });

  assertEquals(plan.taskUpdates[0]?.new_status, 'completed');
  assertEquals(plan.taskUpdates[0]?.correct_count, 4);
  // Güven 5 olsa da isabet %40: tekrar aralığı kısalır, telafi görevi doğar.
  assertEquals((plan.topicReviews[0]?.interval_days ?? 99) <= 1, true);
  assertEquals(plan.newTasks.some((t) => t.title.startsWith('Tekrar:')), true);
});

Deno.test('yüksek isabet aralığı uzatır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskOutcomes: [
        outcome({ taskId: 't-carnot', outcome: 'completed', problemsSolved: 10, correctCount: 10, confidence: 2 }),
      ],
    }),
  });

  // Güven düşük ama isabet tam: ölçüm beyanı yener.
  assertEquals((plan.topicReviews[0]?.interval_days ?? 0) > 1, true);
  assertEquals(plan.newTasks.length, 0);
});

Deno.test('isabet bildirilmemişse eski davranış korunur', () => {
  const withAccuracy = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskOutcomes: [outcome({ taskId: 't-carnot', outcome: 'completed', problemsSolved: 10, confidence: 4 })],
    }),
  });

  assertEquals(withAccuracy.taskUpdates[0]?.correct_count, null);
  assertEquals(withAccuracy.newTasks.length, 0);
});

Deno.test('takılınan yerler hata defterine yazılır, tekrarı yazılmaz', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskOutcomes: [
        outcome({ taskId: 't-carnot', outcome: 'failed', confidence: 1, weakConcept: 'Carnot verimi' }),
      ],
      topicStruggles: [
        { topicId: 'top-carnot', concept: 'Carnot verimi', detail: null, resolved: false, confidence: 2, daysAgo: null },
        { topicId: 'top-gauss', concept: 'Simetri seçimi', detail: null, resolved: false, confidence: 2, daysAgo: null },
      ],
    }),
  });

  const bodies = plan.topicMistakes.map((m) => `${m.topic_id}:${m.body}`);
  assertEquals(bodies.includes('top-carnot:Carnot verimi'), true);
  assertEquals(bodies.includes('top-gauss:Simetri seçimi'), true);
  // Aynı madde iki kez geçmez.
  assertEquals(bodies.filter((b) => b === 'top-carnot:Carnot verimi').length, 1);
});

Deno.test('sorunsuz geçen gün hata defterine bir şey yazmaz', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskOutcomes: [outcome({ taskId: 't-truss', outcome: 'completed', confidence: 5 })],
    }),
  });

  assertEquals(plan.topicMistakes, []);
});

Deno.test('hata defteri öğrencinin kendi cümlesini tutar, etiketi değil', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskOutcomes: [
        outcome({
          taskId: 't-carnot',
          outcome: 'completed',
          problemsSolved: 10,
          correctCount: 6,
          weakConcept: 'Mol hesapları',
          weakDetail: 'molde hesaplamalarda takıldım, birim çevirirken paydayı ters aldım',
        }),
      ],
    }),
  });

  assertEquals(plan.topicMistakes.length, 1);
  assertEquals(plan.topicMistakes[0]?.body, 'molde hesaplamalarda takıldım, birim çevirirken paydayı ters aldım');
  assertEquals(plan.topicMistakes[0]?.concept, 'Mol hesapları');
});

Deno.test('ayrıntı yoksa etiket kullanılır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskOutcomes: [
        outcome({ taskId: 't-carnot', outcome: 'failed', weakConcept: 'Carnot verimi', weakDetail: null }),
      ],
    }),
  });

  assertEquals(plan.topicMistakes[0]?.body, 'Carnot verimi');
  assertEquals(plan.topicMistakes[0]?.concept, 'Carnot verimi');
});

Deno.test('telafi görevi öğrencinin notunu taşır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskOutcomes: [
        outcome({
          taskId: 't-carnot',
          outcome: 'failed',
          weakConcept: 'Carnot verimi',
          weakDetail: 'sıcaklıkları Kelvin’e çevirmeyi unutuyorum',
        }),
      ],
    }),
  });

  const retry = plan.newTasks.find((t) => t.title.startsWith('Tekrar:'));
  assertEquals(retry?.instructions?.includes('Carnot verimi'), true);
  assertEquals(retry?.instructions?.includes('Kelvin'), true);
});

// ---------------------------------------------------------------------------
// "Takıldım ama hallettim": written down, but not scheduled against.
// ---------------------------------------------------------------------------
Deno.test('çözülen takılma tekrar aralığını düşürmez ve telafi görevi doğurmaz', () => {
  const stuck = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskOutcomes: [
        outcome({ taskId: 't-carnot', outcome: 'failed', confidence: 3, weakConcept: 'Carnot verimi' }),
      ],
    }),
  });

  const sorted = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskOutcomes: [
        outcome({
          taskId: 't-carnot',
          outcome: 'failed',
          confidence: 3,
          weakConcept: 'Carnot verimi',
          weakResolved: true,
        }),
      ],
    }),
  });

  assertEquals(stuck.newTasks.length > 0, true);
  assertEquals(sorted.newTasks.length, 0);
  assertEquals((sorted.topicReviews[0]?.interval_days ?? 0) > (stuck.topicReviews[0]?.interval_days ?? 0), true);
  // Yine de deftere yazılır — ama çözülmüş olarak.
  assertEquals(sorted.topicMistakes[0]?.resolved, true);
  assertEquals(stuck.topicMistakes[0]?.resolved, false);
});

Deno.test('göreve bağlı olmayan çözülmüş zorluk da drill üretmez', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      topicStruggles: [
        { topicId: 'top-gauss', concept: 'Simetri seçimi', detail: 'önce şaşırdım, sonra oturdu', resolved: true, confidence: 4, daysAgo: null },
      ],
    }),
  });

  assertEquals(plan.newTasks.length, 0);
  assertEquals(plan.topicMistakes[0]?.resolved, true);
  assertEquals(plan.topicMistakes[0]?.body, 'önce şaşırdım, sonra oturdu');
});

// ---------------------------------------------------------------------------
// Steps: only ever because the student said so.
// ---------------------------------------------------------------------------
Deno.test('ödevin bölümleri alt adım olur, ana görevin gününü alır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      plannedWork: [
        {
          topicId: 'top-gauss',
          title: 'Fizik ödevi',
          type: 'problem_set',
          problemCount: null,
          dueInDays: 2,
          isHomework: true,
          dueDate: null,
          instructions: null,
          subtasks: ['1-8 arası sorular', 'Grafik çizimi', 'Rapor yazımı'],
          replacesTaskIds: [],
        },
      ],
    }),
  });

  const parent = plan.newTasks.find((t) => t.parent_task_id === null);
  const steps = plan.newTasks.filter((t) => t.parent_task_id !== null);
  assertEquals(parent?.title, 'Fizik ödevi');
  assertEquals(steps.length, 3);
  assertEquals(steps.every((step) => step.parent_task_id === parent?.id), true);
  assertEquals(steps.every((step) => step.due_date === parent?.due_date), true);
  // Tahmini süre adımlara bölünür, ana görevinkini aşmaz.
  assertEquals(steps.reduce((total, step) => total + (step.estimated_minutes ?? 0), 0) <= (parent?.estimated_minutes ?? 0), true);
});

Deno.test('bölme istenmediyse ödev tek parça kalır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      plannedWork: [
        {
          topicId: 'top-gauss',
          title: 'Fizik ödevi',
          type: 'problem_set',
          problemCount: null,
          dueInDays: 2,
          isHomework: true,
          dueDate: null,
          instructions: null,
          subtasks: [],
          replacesTaskIds: [],
        },
      ],
    }),
  });

  assertEquals(plan.newTasks.length, 1);
  assertEquals(plan.newTasks[0]?.parent_task_id, null);
});

Deno.test('var olan görev yalnızca açık istekle bölünür', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskBreakdowns: [{ taskId: 't-carnot', steps: ['Teoriyi çıkar', 'Soruları çöz'] }],
    }),
  });

  assertEquals(plan.newTasks.length, 2);
  assertEquals(plan.newTasks.every((t) => t.parent_task_id === 't-carnot'), true);
  assertEquals(plan.newTasks.every((t) => t.due_date === TODAY), true);
});

Deno.test('tek adımlı bölme isteği yok sayılır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({ taskBreakdowns: [{ taskId: 't-carnot', steps: ['Hepsini yap'] }] }),
  });

  assertEquals(plan.newTasks.length, 0);
});

Deno.test('telafi ve tekrar görevleri alt adım üretmez', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskOutcomes: [outcome({ taskId: 't-carnot', outcome: 'failed', confidence: 1 })],
      topicStruggles: [{ topicId: 'top-gauss', concept: 'Simetri', detail: null, resolved: false, confidence: 1, daysAgo: null }],
    }),
  });

  assertEquals(plan.newTasks.length > 0, true);
  assertEquals(plan.newTasks.every((t) => t.parent_task_id === null), true);
});

Deno.test('konusu söylenmeyen ödev dersin son konusuna bağlanır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      plannedWork: [
        {
          topicId: null,
          title: 'Statics ödevini tamamla',
          type: 'problem_set',
          problemCount: null,
          dueInDays: 2,
          isHomework: true,
          dueDate: null,
          instructions: null,
          subtasks: [],
          replacesTaskIds: [],
        },
      ],
    }),
  });

  assertEquals(plan.newTasks.length, 1);
  assertEquals(plan.newTasks[0]?.topic_id, 'top-truss'); // Statics dersinin konusu
  assertEquals(plan.droppedReferences, 0);
});

Deno.test('hiçbir derse bağlanamayan iş düşürülür', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      plannedWork: [
        {
          topicId: null,
          title: 'Bir şeyler yap',
          type: 'problem_set',
          problemCount: null,
          dueInDays: 1,
          isHomework: true,
          dueDate: null,
          instructions: null,
          subtasks: [],
          replacesTaskIds: [],
        },
      ],
    }),
  });

  assertEquals(plan.newTasks.length, 0);
  assertEquals(plan.droppedReferences, 1);
});

// ---------------------------------------------------------------------------
// Emptying a day the student cannot work
// ---------------------------------------------------------------------------
const SUNDAY = '2026-10-11'; // TODAY is a Monday, so Sunday is six days ahead
const clearance = (
  over: Partial<CheckinExtraction['dayClearances'][number]> = {},
): CheckinExtraction['dayClearances'][number] => ({
  daysAhead: 6,
  untilDaysAhead: null,
  spreadFromDaysAhead: 0,
  everyWeek: false,
  reason: 'o gün hiçbir şey yapamam',
  ...over,
});

const sundayTasks: CandidateTask[] = [
  task('t-sun-1', 'top-truss', { dueDate: SUNDAY, estimatedMinutes: 60 }),
  task('t-sun-2', 'top-carnot', { dueDate: SUNDAY, estimatedMinutes: 60 }),
];

Deno.test('kapatılan günün görevleri başka günlere taşınır, silinmez', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: sundayTasks,
    topics,
    extraction: extraction({ dayClearances: [clearance()] }),
  });

  assertEquals(plan.taskMoves.map((m) => m.task_id).sort(), ['t-sun-1', 't-sun-2']);
  assertEquals(plan.taskRemovals, []);
  assertEquals(plan.taskUpdates, []);
  // Hiçbiri kapatılan güne geri konmadı.
  assertEquals(plan.taskMoves.some((m) => m.due_date === SUNDAY), false);
  assertEquals(plan.clearedDates, [SUNDAY]);
});

Deno.test('dağıtım bugünden başlar ve kapasiteye uyar', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: sundayTasks,
    topics,
    extraction: extraction({ dayClearances: [clearance()] }),
    // Günde tek bir 60 dakikalık iş sığıyor.
    capacityByWeekday: { 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 60, 7: 60 },
  });

  assertEquals(
    plan.taskMoves.map((m) => [m.task_id, m.due_date]),
    [
      ['t-sun-1', TODAY],
      ['t-sun-2', '2026-10-06'],
    ],
  );
});

Deno.test('"yarından itibaren dağıt" bugüne iş koymaz', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: sundayTasks,
    topics,
    extraction: extraction({ dayClearances: [clearance({ spreadFromDaysAhead: 1 })] }),
    capacityByWeekday: { 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 60, 7: 60 },
  });

  assertEquals(plan.taskMoves.some((m) => m.due_date === TODAY), false);
});

Deno.test('"pazarları hiç çalışamam" haftanın o gününü kapatır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: sundayTasks,
    topics,
    extraction: extraction({ dayClearances: [clearance({ everyWeek: true })] }),
  });

  assertEquals(plan.blockWeekdays, [7]);
  // Penceredeki her pazar boşaltılır, yalnızca ilki değil.
  assertEquals(plan.clearedDates, [SUNDAY, '2026-10-18']);
});

Deno.test('kapalı gün olarak işaretli günlere iş taşınmaz', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [task('t-sat', 'top-truss', { dueDate: '2026-10-10', estimatedMinutes: 60 })],
    topics,
    // Cumartesi boşaltılıyor; pazar zaten kapalı.
    extraction: extraction({ dayClearances: [clearance({ daysAhead: 5 })] }),
    capacityByWeekday: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 240 },
    blockedWeekdays: [7],
  });

  assertEquals(plan.taskMoves.length, 1);
  assertEquals(plan.taskMoves[0]?.due_date === SUNDAY, false);
});

Deno.test('raporda üzerinde çalışılan veya silinen görev taşınmaz', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [...sundayTasks, task('t-sun-3', 'top-gauss', { dueDate: SUNDAY })],
    topics,
    extraction: extraction({
      dayClearances: [clearance()],
      taskOutcomes: [outcome({ taskId: 't-sun-1', outcome: 'completed' })],
      taskRemovals: [{ taskId: 't-sun-2', reason: 'gerek yok' }],
    }),
  });

  assertEquals(plan.taskMoves.map((m) => m.task_id), ['t-sun-3']);
});

Deno.test('teslim tarihli ödev, kapanan günden öne çekilir', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [task('t-odev', 'top-truss', { dueDate: SUNDAY, estimatedMinutes: 60, source: 'homework' })],
    topics,
    extraction: extraction({ dayClearances: [clearance()] }),
  });

  assertEquals(plan.taskMoves.length, 1);
  assertEquals((plan.taskMoves[0]?.due_date ?? '') < SUNDAY, true);
});

Deno.test('tek görev için taşıma isteği o güne gider', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({ taskReschedules: [{ taskId: 't-truss', dueInDays: 3 }] }),
  });

  assertEquals(plan.taskMoves, [{ task_id: 't-truss', due_date: '2026-10-08' }]);
});

Deno.test('bilinmeyen görev için taşıma isteği düşürülür', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({ taskReschedules: [{ taskId: 'yok', dueInDays: 2 }] }),
  });

  assertEquals(plan.taskMoves, []);
  assertEquals(plan.droppedReferences, 1);
});

Deno.test('kapanan günde taşınacak iş yoksa hiçbir şey olmaz', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({ dayClearances: [clearance()] }),
  });

  assertEquals(plan.taskMoves, []);
  assertEquals(plan.blockWeekdays, []);
});

// ---------------------------------------------------------------------------
// The check-in's authority: everything the student can change by hand.
// ---------------------------------------------------------------------------

const courses = [{ id: 'c-phys', name: 'Physics 2' }];
const exams = [{ id: 'e-mid', courseId: 'c-phys', title: 'Fizik vize', examDate: '2026-10-20' }];
const openMistakes = [{ id: 'm-open', topicId: 'top-gauss', body: 'akı hesabında yüzeyi ters seçtim' }];

Deno.test('görev düzenlemesi: yalnızca söylenen alanlar, sütunun kabul ettiği aralıkta', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskEdits: [
        {
          taskId: 't-carnot',
          newTitle: 'Carnot çevrimi raporu',
          instructions: null,
          type: null,
          targetCount: 25,
          // Well over the column's ceiling: clamped, never sent as written.
          estimatedMinutes: 5_000,
          startsInDays: null,
          dayMinutes: [],
        },
      ],
    }),
  });

  assertEquals(plan.taskEdits, [
    { task_id: 't-carnot', fields: { title: 'Carnot çevrimi raporu', target_count: 25, estimated_minutes: 600 } },
  ]);
});

Deno.test('görev düzenlemesi: teslimden sonraya konan başlangıç günü teslime çekilir', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [task('t-late', 'top-truss', { dueDate: '2026-10-07' })],
    topics,
    extraction: extraction({
      taskEdits: [
        {
          taskId: 't-late',
          newTitle: null,
          instructions: null,
          type: null,
          targetCount: null,
          estimatedMinutes: null,
          startsInDays: 9,
          dayMinutes: [],
        },
      ],
    }),
  });

  assertEquals(plan.taskEdits[0]?.fields.starts_on, '2026-10-07');
});

Deno.test('görev düzenlemesi: elle gün payı tarihe çevrilir, sıfır kapalı gün demektir', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskEdits: [
        {
          taskId: 't-truss',
          newTitle: null,
          instructions: null,
          type: null,
          targetCount: null,
          estimatedMinutes: null,
          startsInDays: null,
          dayMinutes: [
            { daysAhead: 1, minutes: 60 },
            { daysAhead: 2, minutes: 0 },
          ],
        },
      ],
    }),
  });

  assertEquals(plan.taskEdits[0]?.fields.day_allocations, { '2026-10-06': 60, '2026-10-07': 0 });
});

Deno.test('görev düzenlemesi: bilinmeyen görev düşürülür, boş düzenleme satır açmaz', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskEdits: [
        {
          taskId: 'hayali-görev',
          newTitle: 'olmaz',
          instructions: null,
          type: null,
          targetCount: null,
          estimatedMinutes: null,
          startsInDays: null,
          dayMinutes: [],
        },
        {
          taskId: 't-truss',
          newTitle: null,
          instructions: null,
          type: null,
          targetCount: null,
          estimatedMinutes: null,
          startsInDays: null,
          dayMinutes: [],
        },
      ],
    }),
  });

  assertEquals(plan.taskEdits, []);
  assertEquals(plan.droppedReferences, 1);
});

Deno.test('gruplama: görevlerden biri bütünse diğerleri onun adımı olur', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskGroups: [{ parentTaskId: 't-truss', newParentTitle: null, childTaskIds: ['t-carnot', 't-truss'] }],
    }),
  });

  // The parent cannot also be its own step.
  assertEquals(plan.taskGroups, [{ parent_task_id: 't-truss', child_task_ids: ['t-carnot'] }]);
  assertEquals(plan.newTasks.length, 0);
});

Deno.test('gruplama: bütün yoksa kapsayıcı görev doğar ve son teslimi devralır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [
      task('t-a', 'top-truss', { dueDate: '2026-10-06' }),
      task('t-b', 'top-truss', { dueDate: '2026-10-09' }),
    ],
    topics,
    extraction: extraction({
      taskGroups: [{ parentTaskId: null, newParentTitle: 'Statik ödev paketi', childTaskIds: ['t-a', 't-b'] }],
    }),
  });

  const container = plan.newTasks[0];
  assertEquals(container?.title, 'Statik ödev paketi');
  assertEquals(container?.due_date, '2026-10-09');
  assertEquals(container?.parent_task_id, null);
  assertEquals(plan.taskGroups, [{ parent_task_id: container?.id ?? '', child_task_ids: ['t-a', 't-b'] }]);
});

Deno.test('gruplama: tek görev için kapsayıcı açılmaz', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskGroups: [{ parentTaskId: null, newParentTitle: 'Tek başına', childTaskIds: ['t-truss'] }],
    }),
  });

  assertEquals(plan.taskGroups, []);
  assertEquals(plan.newTasks.length, 0);
});

Deno.test('not ve süre: görev doğrulanır, süre rapor gününe yazılır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      taskNotes: [
        { taskId: 't-truss', body: 'Hoca formül tablosu verecekmiş.' },
        { taskId: 'yok', body: 'düşecek' },
      ],
      timeLogs: [{ taskId: 't-truss', minutes: 40, daysAgo: 1 }],
    }),
  });

  assertEquals(plan.taskNotes, [{ task_id: 't-truss', body: 'Hoca formül tablosu verecekmiş.' }]);
  assertEquals(plan.timeLogs, [{ task_id: 't-truss', minutes: 40, on_date: '2026-10-04' }]);
  assertEquals(plan.coveredDates.includes('2026-10-04'), true);
});

Deno.test('sınav takvimi: ekleme derse bağlanır, erteleme tarihe çevrilir, iptal geçer', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    courses,
    exams,
    extraction: extraction({
      examChanges: [
        { action: 'update', examId: 'e-mid', courseId: null, kind: null, title: null, dateInDays: 21, exactDate: null },
        { action: 'insert', examId: null, courseId: 'c-phys', kind: 'quiz', title: null, dateInDays: 7, exactDate: null },
        { action: 'delete', examId: 'e-mid', courseId: null, kind: null, title: null, dateInDays: null, exactDate: null },
      ],
    }),
  });

  assertEquals(plan.examChanges, [
    { action: 'update', exam_id: 'e-mid', course_id: null, kind: null, title: null, exam_date: '2026-10-26' },
    // No title given, so the course names it.
    { action: 'insert', exam_id: null, course_id: 'c-phys', kind: 'quiz', title: 'Physics 2 sınavı', exam_date: '2026-10-12' },
  ]);
});

Deno.test('sınav takvimi: dersi veya tarihi olmayan ekleme ve boş güncelleme düşer', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    courses,
    exams,
    extraction: extraction({
      examChanges: [
        { action: 'insert', examId: null, courseId: 'c-phys', kind: null, title: 'Tarihi yok', dateInDays: null, exactDate: null },
        { action: 'update', examId: 'e-mid', courseId: null, kind: null, title: null, dateInDays: null, exactDate: null },
      ],
    }),
  });

  assertEquals(plan.examChanges, []);
  assertEquals(plan.droppedReferences, 1);
});

Deno.test('hata defteri: yalnızca açık listedeki maddeler kapatılır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    openMistakes,
    extraction: extraction({
      mistakeResolutions: [{ mistakeId: 'm-open' }, { mistakeId: 'm-open' }, { mistakeId: 'm-yok' }],
    }),
  });

  assertEquals(plan.mistakeResolutions, [{ mistake_id: 'm-open' }]);
  assertEquals(plan.droppedReferences, 1);
});

Deno.test('taşınan görevin gün kararları düzenlemeden düşer', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [task('t-sun-1', 'top-truss', { dueDate: SUNDAY, estimatedMinutes: 60 })],
    topics,
    extraction: extraction({
      dayClearances: [clearance()],
      taskEdits: [
        {
          taskId: 't-sun-1',
          newTitle: 'Kafes ödevi',
          instructions: null,
          type: null,
          targetCount: null,
          estimatedMinutes: null,
          // Kapanan güne göre verilmiş kararlar: görev taşınınca anlamını yitirir.
          startsInDays: 2,
          dayMinutes: [{ daysAhead: 6, minutes: 60 }],
        },
      ],
    }),
  });

  assertEquals(plan.taskMoves.length, 1);
  assertEquals(plan.taskEdits.length, 1);
  assertEquals(plan.taskEdits[0]?.fields['title'], 'Kafes ödevi');
  assertEquals('starts_on' in (plan.taskEdits[0]?.fields ?? {}), false);
  assertEquals('day_allocations' in (plan.taskEdits[0]?.fields ?? {}), false);
});

// ---------------------------------------------------------------------------
// Gün hedefi ve döngü sırası
// ---------------------------------------------------------------------------
Deno.test('gün hedefi: pazartesiye 2 ana görev denince fazlası taşınır', () => {
  const monday = [
    task('m-1', 'top-truss', { dueDate: TODAY, type: 'concept_note', estimatedMinutes: 30 }),
    task('m-2', 'top-carnot', { dueDate: TODAY, type: 'feynman', estimatedMinutes: 30 }),
    task('m-3', 'top-gauss', { dueDate: TODAY, type: 'quiz', estimatedMinutes: 30 }),
  ];
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: monday,
    topics,
    extraction: extraction({ dayTargets: [{ daysAhead: 0, maxMainTasks: 2 }] }),
    capacityByWeekday: { 1: 240, 2: 240, 3: 240, 4: 240, 5: 240, 6: 240, 7: 240 },
  });

  assertEquals(plan.taskMoves.length, 1);
  // Döngüde en geç adım gününü bırakır: sınav.
  assertEquals(plan.taskMoves[0]?.task_id, 'm-3');
  assertEquals(plan.taskMoves[0]?.due_date > TODAY, true);
});

Deno.test('gün boşaltma sınavı Feynman gününün önüne düşürmez', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [
      // Pazar boşaltılacak; sınav oradan bir yere gidecek.
      task('t-quiz', 'top-truss', { dueDate: SUNDAY, type: 'quiz', estimatedMinutes: 30 }),
      task('t-feynman', 'top-truss', { dueDate: '2026-10-08', type: 'feynman', estimatedMinutes: 30 }),
    ],
    topics,
    extraction: extraction({ dayClearances: [clearance()] }),
    capacityByWeekday: { 1: 240, 2: 240, 3: 240, 4: 240, 5: 240, 6: 240, 7: 240 },
  });

  const quizDay = plan.taskMoves.find((m) => m.task_id === 't-quiz')?.due_date;
  assertEquals(quizDay !== undefined, true);
  // Feynman 8 Ekim'de: sınav o gün ya da sonrasında olabilir, öncesinde asla.
  assertEquals((quizDay ?? '') >= '2026-10-08', true);
});

Deno.test('raporun dokunmadığı konunun sırası kendiliğinden değişmez', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [
      // Bozuk sıra, ama rapor bu konudan hiç söz etmiyor.
      task('o-quiz', 'top-carnot', { dueDate: '2026-10-06', type: 'quiz' }),
      task('o-feynman', 'top-carnot', { dueDate: '2026-10-07', type: 'feynman' }),
      task('t-sun', 'top-truss', { dueDate: SUNDAY, type: 'concept_note' }),
    ],
    topics,
    extraction: extraction({ dayClearances: [clearance()] }),
    capacityByWeekday: { 1: 240, 2: 240, 3: 240, 4: 240, 5: 240, 6: 240, 7: 240 },
  });

  assertEquals(plan.taskMoves.map((m) => m.task_id), ['t-sun']);
});

Deno.test('sayı verilmeyen gün hedefi düşürülür', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({ dayTargets: [{ daysAhead: Number.NaN, maxMainTasks: 2 }] }),
  });

  assertEquals(plan.taskMoves, []);
});

// ---------------------------------------------------------------------------
// Meşgul öğrencinin cümleleri: toplu sonuç, gün süresi, ders bekletme…
// ---------------------------------------------------------------------------
const TUESDAY = '2026-10-06';
const WIDE = { 1: 240, 2: 240, 3: 240, 4: 240, 5: 240, 6: 240, 7: 240 };
type Bulk = CheckinExtraction['bulkOutcomes'][number];
const bulk = (over: Partial<Bulk> = {}): Bulk => ({
  daysAgo: null,
  outcome: 'completed',
  courseIds: [],
  exceptTaskIds: [],
  ...over,
});
/** A learning card: the container and its two steps, one sitting. */
const learningCard = (id: string, topicId: string, dueDate: string): CandidateTask[] => [
  task(id, topicId, { dueDate, type: 'learning', estimatedMinutes: null, targetCount: null }),
  task(`${id}-c`, topicId, { dueDate, type: 'concept_note', estimatedMinutes: 30, targetCount: null, parentTaskId: id }),
  task(`${id}-f`, topicId, { dueDate, type: 'feynman', estimatedMinutes: 30, targetCount: null, parentTaskId: id }),
];

Deno.test('"bugünkü her şeyi bitirdim": günün açık görevleri kapanır, ayrıca anılan görev kendi sonucunu alır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [
      task('t-a', 'top-truss'),
      task('t-b', 'top-carnot', { targetCount: 10 }),
      task('t-tomorrow', 'top-gauss', { dueDate: TUESDAY }),
      task('t-done', 'top-truss', { status: 'completed', completedCount: 30 }),
    ],
    topics,
    extraction: extraction({
      bulkOutcomes: [bulk()],
      taskOutcomes: [outcome({ taskId: 't-b', outcome: 'failed', confidence: 2 })],
    }),
  });

  assertEquals(plan.taskUpdates.map((u) => [u.task_id, u.new_status]), [
    ['t-b', 'failed'],
    ['t-a', 'completed'],
  ]);
  assertEquals(plan.schedule.bulkCompletedTaskIds, ['t-a']);
});

Deno.test('toplu bitirme öğrenme kartını adımlarından kapatır, kapsayıcıya dokunmaz', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: learningCard('L', 'top-truss', TODAY),
    topics,
    extraction: extraction({ bulkOutcomes: [bulk()] }),
  });

  assertEquals(plan.taskUpdates.map((u) => u.task_id).sort(), ['L-c', 'L-f']);
});

Deno.test('toplu sonuç ders ve istisnayla daraltılır; dar olan geniş olanı yener', () => {
  const today = [task('t-a', 'top-truss'), task('t-b', 'top-carnot'), task('t-g', 'top-gauss')];

  const narrowed = planCheckinEffects({
    logDate: TODAY,
    tasks: today,
    topics,
    extraction: extraction({ bulkOutcomes: [bulk({ courseIds: ['c-statics', 'c-thermo'], exceptTaskIds: ['t-b'] })] }),
  });
  assertEquals(narrowed.taskUpdates.map((u) => u.task_id), ['t-a']);

  // "Fizikte hiçbir şey yapmadım, geri kalan her şeyi bitirdim."
  const mixed = planCheckinEffects({
    logDate: TODAY,
    tasks: today,
    topics,
    capacityByWeekday: WIDE,
    extraction: extraction({
      bulkOutcomes: [bulk(), bulk({ outcome: 'not_attempted', courseIds: ['c-phys'] })],
    }),
  });
  assertEquals(mixed.taskUpdates.map((u) => u.task_id).sort(), ['t-a', 't-b']);
  assertEquals(mixed.taskMoves.map((m) => m.task_id), ['t-g']);
});

Deno.test('"bugün hiç çalışamadım": görevler kopyalanmaz, sonraki günlere taşınır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [task('t-a', 'top-truss', { estimatedMinutes: 60 }), task('t-b', 'top-carnot', { estimatedMinutes: 60 })],
    topics,
    capacityByWeekday: WIDE,
    extraction: extraction({ bulkOutcomes: [bulk({ outcome: 'not_attempted' })] }),
  });

  assertEquals(plan.taskUpdates, []);
  assertEquals(plan.newTasks, []);
  assertEquals(plan.taskMoves.length, 2);
  assertEquals(plan.taskMoves.every((m) => m.due_date > TODAY), true);
  assertEquals(plan.schedule.missedDates, [TODAY]);
});

Deno.test('boşaltılan günden öğrenme kartı bütün olarak taşınır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: learningCard('L', 'top-truss', SUNDAY),
    topics,
    capacityByWeekday: WIDE,
    extraction: extraction({ dayClearances: [clearance()] }),
  });

  const days = new Set(plan.taskMoves.map((m) => m.due_date));
  assertEquals(plan.taskMoves.map((m) => m.task_id).sort(), ['L', 'L-c', 'L-f']);
  assertEquals(days.size, 1);
});

Deno.test('"cumadan pazartesiye kadar yokum": aralığın her günü boşalır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [
      task('t-sat', 'top-truss', { dueDate: '2026-10-10', estimatedMinutes: 30 }),
      task('t-sun', 'top-carnot', { dueDate: SUNDAY, estimatedMinutes: 30 }),
    ],
    topics,
    capacityByWeekday: WIDE,
    extraction: extraction({ dayClearances: [clearance({ daysAhead: 4, untilDaysAhead: 7 })] }),
  });

  assertEquals(plan.clearedDates, ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']);
  assertEquals(plan.taskMoves.length, 2);
  assertEquals(plan.taskMoves.some((m) => plan.clearedDates.includes(m.due_date)), false);
});

Deno.test('"pazarları artık çalışabiliyorum" kapalı günü açar; aynı raporda kapatma kazanır', () => {
  const reopened = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    blockedWeekdays: [7],
    extraction: extraction({ reopenedWeekdays: [{ daysAhead: 6 }] }),
  });
  assertEquals(reopened.reopenWeekdays, [7]);

  const alreadyOpen = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({ reopenedWeekdays: [{ daysAhead: 6 }] }),
  });
  assertEquals(alreadyOpen.reopenWeekdays, []);
  assertEquals(alreadyOpen.notes, ['Pazar zaten kapalı bir gün değildi.']);

  const contradiction = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    blockedWeekdays: [7],
    extraction: extraction({
      dayClearances: [clearance({ everyWeek: true })],
      reopenedWeekdays: [{ daysAhead: 6 }],
    }),
  });
  assertEquals([contradiction.blockWeekdays, contradiction.reopenWeekdays], [[7], []]);
});

Deno.test('"yarın sadece 1 saatim var": döngünün başı kalır, sınav önce gider', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [
      ...learningCard('L', 'top-truss', TUESDAY),
      task('q', 'top-gauss', { dueDate: TUESDAY, type: 'quiz', estimatedMinutes: 30 }),
      task('p', 'top-carnot', { dueDate: TUESDAY, estimatedMinutes: 30 }),
    ],
    topics,
    capacityByWeekday: WIDE,
    extraction: extraction({ dayLoads: [{ daysAhead: 1, untilDaysAhead: null, minutes: 60 }] }),
  });

  assertEquals(plan.taskMoves.map((m) => m.task_id).sort(), ['p', 'q']);
  assertEquals(plan.taskMoves.every((m) => m.due_date > TUESDAY), true);
  assertEquals(plan.schedule.dayBudgets, [{ date: TUESDAY, minutes: 60 }]);
});

Deno.test('"hafif olsun" sayı söylemez: gün her zamankinin yarısını alır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    capacityByWeekday: { ...WIDE, 2: 130 },
    extraction: extraction({ dayLoads: [{ daysAhead: 1, untilDaysAhead: 2, minutes: null }] }),
  });

  assertEquals(plan.schedule.dayBudgets, [
    { date: TUESDAY, minutes: 65 },
    { date: '2026-10-07', minutes: 120 },
  ]);
});

Deno.test('süre sınırı o gün teslimi olan ödevi yerinden oynatmaz', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [task('hw', 'top-gauss', { dueDate: TUESDAY, source: 'homework', estimatedMinutes: 90 })],
    topics,
    capacityByWeekday: WIDE,
    extraction: extraction({ dayLoads: [{ daysAhead: 1, untilDaysAhead: null, minutes: 60 }] }),
  });

  assertEquals(plan.taskMoves, []);
  assertEquals(plan.notes, ['yarın için söylediğin süre, o gün teslimi olan işe yetmiyor.']);
});

Deno.test('"bu hafta termodinamiği dondur": aralıktaki iş sonrasına gider, teslimli ödev kalır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [
      task('c-study', 'top-carnot', { dueDate: TUESDAY, estimatedMinutes: 30 }),
      task('c-hw', 'top-carnot', { dueDate: '2026-10-07', source: 'homework', title: 'Carnot ödevi' }),
      task('t-study', 'top-truss', { dueDate: TUESDAY, estimatedMinutes: 30 }),
    ],
    topics,
    capacityByWeekday: WIDE,
    extraction: extraction({
      courseHolds: [{ mode: 'pause', courseIds: ['c-thermo'], fromDaysAhead: 0, untilDaysAhead: 6 }],
    }),
  });

  assertEquals(plan.taskMoves.map((m) => m.task_id), ['c-study']);
  assertEquals((plan.taskMoves[0]?.due_date ?? '') > SUNDAY, true);
  assertEquals(plan.notes, ['"Carnot ödevi" teslimi bu aralıkta olduğu için yerinde kaldı.']);
  assertEquals(plan.schedule.holds, [{ mode: 'pause', courseIds: ['c-thermo'], from: TODAY, until: SUNDAY }]);
});

Deno.test('"yarın sadece fiziğe çalışacağım": diğer derslerin işi o günden çıkar', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [
      task('g', 'top-gauss', { dueDate: TUESDAY, estimatedMinutes: 30 }),
      task('t', 'top-truss', { dueDate: TUESDAY, estimatedMinutes: 30 }),
      task('c', 'top-carnot', { dueDate: TUESDAY, estimatedMinutes: 30 }),
    ],
    topics,
    capacityByWeekday: WIDE,
    extraction: extraction({
      courseHolds: [{ mode: 'only', courseIds: ['c-phys'], fromDaysAhead: 1, untilDaysAhead: null }],
    }),
  });

  assertEquals(plan.taskMoves.map((m) => m.task_id).sort(), ['c', 't']);
  assertEquals(plan.taskMoves.every((m) => m.due_date > TUESDAY), true);
});

Deno.test('bilinmeyen dersi bekletme isteği düşer', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      courseHolds: [{ mode: 'pause', courseIds: ['uydurma'], fromDaysAhead: 0, untilDaysAhead: 3 }],
    }),
  });

  assertEquals([plan.droppedReferences, plan.taskMoves, plan.schedule.holds], [1, [], []]);
});

Deno.test('kendi planladığı iş ödev sayılmaz; takvim tarihi gün sayısını yener', () => {
  const work = (over: Partial<CheckinExtraction['plannedWork'][number]>): CheckinExtraction['plannedWork'][number] => ({
    topicId: 'top-gauss',
    title: 'Türev soruları',
    type: 'problem_set',
    problemCount: 20,
    isHomework: false,
    dueInDays: 1,
    dueDate: null,
    instructions: null,
    subtasks: [],
    replacesTaskIds: [],
    ...over,
  });
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      plannedWork: [
        work({}),
        work({ title: 'Proje raporu', isHomework: true, dueInDays: 2, dueDate: '2026-11-20' }),
        work({ title: 'Olmayan gün', isHomework: true, dueInDays: 2, dueDate: '2026-02-30' }),
      ],
    }),
  });

  assertEquals(plan.newTasks.map((t) => [t.title, t.source, t.due_date]), [
    ['Türev soruları', 'manual', TUESDAY],
    ['Proje raporu', 'homework', '2026-11-20'],
    ['Olmayan gün', 'homework', '2026-10-07'],
  ]);
});

Deno.test('sınav tarihi söylenen takvim gününe yazılır, uzak final kırpılmaz', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    courses,
    exams,
    extraction: extraction({
      examChanges: [
        { action: 'update', examId: 'e-mid', courseId: null, kind: null, title: null, dateInDays: 3, exactDate: '2026-12-05' },
        { action: 'insert', examId: null, courseId: 'c-phys', kind: 'final', title: 'Final', dateInDays: null, exactDate: '2027-02-15' },
        { action: 'insert', examId: null, courseId: 'c-phys', kind: 'quiz', title: 'Quiz', dateInDays: 7, exactDate: 'yarın' },
      ],
    }),
  });

  assertEquals(plan.examChanges.map((c) => c.exam_date), ['2026-12-05', '2027-02-15', '2026-10-12']);
});

Deno.test('sorular gününe çevrilir; tarihsiz gün sorusu ertesi günü sorar, tekrarlar birleşir', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      infoRequests: [
        { kind: 'day_agenda', daysAhead: null },
        { kind: 'day_agenda', daysAhead: 1 },
        { kind: 'exams', daysAhead: 5 },
      ],
    }),
  });

  assertEquals(plan.questions, [
    { kind: 'day_agenda', date: TUESDAY },
    { kind: 'exams', date: null },
  ]);
});

Deno.test('"hepsini bitirdim ama Feynman\'da takıldım": yalnızca anılan adım dışarıda kalır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: learningCard('L', 'top-truss', TODAY),
    topics,
    extraction: extraction({
      bulkOutcomes: [bulk()],
      taskOutcomes: [outcome({ taskId: 'L-f', outcome: 'failed', confidence: 2 })],
    }),
  });

  assertEquals(plan.taskUpdates.map((u) => [u.task_id, u.new_status]), [
    ['L-f', 'failed'],
    ['L-c', 'completed'],
  ]);
});

// ---------------------------------------------------------------------------
// Plan dışı çalışma, sınav sonucu ve planı, aciliyet, hatırlatma
// ---------------------------------------------------------------------------
Deno.test('"plan dışı 15 soru çözdüm, 6 doğru": bitmiş iş olur, isabet tekrar takvimine ve deftere gider', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      extraWork: [
        { topicId: 'top-gauss', problemsSolved: 15, correctCount: 6, minutes: 40, daysAgo: 1 },
        { topicId: 'top-truss', problemsSolved: null, correctCount: null, minutes: null, daysAgo: null },
        { topicId: 'uydurma', problemsSolved: 5, correctCount: null, minutes: null, daysAgo: null },
      ],
    }),
  });

  assertEquals(
    plan.extraWork.map((w) => [w.topic_id, w.title, w.completed_count, w.correct_count, w.session_minutes, w.on_date]),
    [
      ['top-gauss', "Ek çalışma: Gauss's law — 15 soru", 15, 6, 40, '2026-10-04'],
      ['top-truss', 'Ek çalışma: Trusses', 0, null, null, TODAY],
    ],
  );
  assertEquals(plan.droppedReferences, 1);
  // 6/15 is a failed recall: the topic comes back tomorrow of the day it happened.
  assertEquals(plan.topicReviews.find((r) => r.topic_id === 'top-gauss')?.repetitions, 0);
  assertEquals(plan.topicMistakes.map((m) => m.body), ['Ek çalışma: isabet 6/15']);
});

Deno.test('söylenmeyen doğru sayısı "hepsi doğru" sayılmaz', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      extraWork: [{ topicId: 'top-gauss', problemsSolved: 10, correctCount: 14, minutes: null, daysAgo: null }],
    }),
  });
  // More right than solved is a misread: clamped to what was solved.
  assertEquals(plan.extraWork[0]?.correct_count, 10);

  const unsaid = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      extraWork: [{ topicId: 'top-gauss', problemsSolved: 10, correctCount: null, minutes: null, daysAgo: null }],
    }),
  });
  assertEquals(unsaid.extraWork[0]?.correct_count, null);
});

Deno.test('"vizeden 65 aldım, Gauss\'ta zorlandım": konular sınavın notuyla, zor konu başarısız sayılır', () => {
  const pastExam = [{ id: 'e-past', courseId: 'c-phys', title: 'Fizik vize', examDate: '2026-10-02' }];
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [
      task('cram-open', 'top-gauss', { source: 'exam_cram', originExamId: 'e-past', dueDate: '2026-10-01' }),
      task('cram-done', 'top-gauss', { source: 'exam_cram', originExamId: 'e-past', status: 'completed' }),
    ],
    topics,
    exams: pastExam,
    examTopicIds: { 'e-past': ['top-truss', 'top-gauss'] },
    extraction: extraction({
      examResults: [{ examId: 'e-past', outcome: 5, score: 65, maxScore: null, hardTopicIds: ['top-gauss'] }],
    }),
  });

  // The score outranks the mood: 65% is "idare eder", not 5.
  assertEquals(plan.examResults, [{ exam_id: 'e-past', outcome: 3, note: '65/100' }]);
  const truss = plan.topicReviews.find((r) => r.topic_id === 'top-truss');
  const gauss = plan.topicReviews.find((r) => r.topic_id === 'top-gauss');
  assertEquals([truss?.repetitions, gauss?.repetitions], [3, 0]);
  assertEquals(plan.taskRemovals.map((r) => r.task_id), ['cram-open']);
});

Deno.test('henüz yapılmamış sınavın sonucu yazılmaz; "40 üzerinden 30" yüzdeye kodda çevrilir', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    exams: [
      { id: 'e-future', courseId: 'c-phys', title: 'Fizik final', examDate: '2026-12-20' },
      { id: 'e-quiz', courseId: 'c-phys', title: 'Quiz', examDate: TODAY },
    ],
    extraction: extraction({
      examResults: [
        { examId: 'e-future', outcome: 4, score: null, maxScore: null, hardTopicIds: [] },
        { examId: 'e-quiz', outcome: null, score: 30, maxScore: 40, hardTopicIds: [] },
      ],
    }),
  });

  assertEquals(plan.examResults, [{ exam_id: 'e-quiz', outcome: 4, note: '30/40' }]);
  assertEquals(plan.notes, ['Fizik final henüz yapılmadı; sonucunu sınavdan sonra yazabilirsin.']);
});

Deno.test('"vize için plan çıkar": sınav ekranının planı görev olur, dokunulmamış eski sprint yerini bırakır', () => {
  const exam = { id: 'e-soon', courseId: 'c-phys', title: 'Fizik vize', examDate: '2026-10-08' };
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [
      task('old-sprint', 'top-gauss', { source: 'exam_cram', originExamId: 'e-soon' }),
      task('started', 'top-gauss', { source: 'exam_cram', originExamId: 'e-soon', completedCount: 3, status: 'in_progress' }),
    ],
    topics,
    exams: [exam],
    capacityByWeekday: WIDE,
    cramContexts: [
      {
        examId: 'e-soon',
        topics: [
          { id: 'top-gauss', title: 'Gauss', weekNumber: 2, position: 0, easeFactor: 2.5, repetitions: 0, nextReviewOn: null, completedSteps: [], recentFailures: 0 },
        ],
      },
    ],
    extraction: extraction({ examPlans: [{ examId: 'e-soon' }] }),
  });

  const sprint = plan.newTasks.filter((t) => t.source === 'exam_cram');
  assertEquals(sprint.map((t) => t.type), ['concept_note', 'feynman', 'quiz']);
  assertEquals(sprint.every((t) => t.due_date < exam.examDate), true);
  assertEquals(plan.examLinks.length, 3);
  assertEquals(plan.examLinks.every((link) => link.exam_id === 'e-soon'), true);
  assertEquals(plan.taskRemovals.map((r) => r.task_id), ['old-sprint']);
  const days = new Set(sprint.map((t) => t.due_date)).size;
  assertEquals(plan.schedule.examPlans, [{ examId: 'e-soon', tasks: 3, days }]);
});

Deno.test('sınava bir haftadan fazla varsa plan çıkarılmaz, nedeni söylenir', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    exams: [{ id: 'e-far', courseId: 'c-phys', title: 'Fizik final', examDate: '2026-11-20' }],
    cramContexts: [{ examId: 'e-far', topics: [] }],
    extraction: extraction({ examPlans: [{ examId: 'e-far' }] }),
  });

  assertEquals(plan.newTasks, []);
  assertEquals(plan.notes.length, 1);
  assertEquals(plan.notes[0]?.startsWith('Fizik final için 46 gün var'), true);
});

Deno.test('"fizik ödevi acil": işaret kartın kendisine konur ve o gün süre sınırında yerinde kalır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [
      ...learningCard('L', 'top-truss', TUESDAY),
      task('hw', 'top-gauss', { dueDate: TUESDAY, estimatedMinutes: 60 }),
      task('already', 'top-carnot', { isPriority: true }),
    ],
    topics,
    capacityByWeekday: WIDE,
    extraction: extraction({
      // Marked on a step, and on a task that already is urgent.
      priorities: [
        { taskId: 'L-f', urgent: false },
        { taskId: 'hw', urgent: true },
        { taskId: 'already', urgent: true },
      ],
      dayLoads: [{ daysAhead: 1, untilDaysAhead: null, minutes: 60 }],
    }),
  });

  assertEquals(plan.priorities, [{ task_id: 'hw', is_priority: true }]);
  // One hour, an urgent hour-long task: the urgent one stays, the card goes.
  assertEquals(plan.taskMoves.map((m) => m.task_id).includes('hw'), false);
  assertEquals(plan.taskMoves.map((m) => m.task_id).sort(), ['L', 'L-c', 'L-f']);
});

Deno.test('hatırlatmalar gerçek bir gün ve saate çevrilir', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    extraction: extraction({
      reminders: [
        { daysAhead: 1, time: '9:00', text: 'Fizik ödevini teslim et' },
        { daysAhead: 4, time: '21.30', text: 'Quiz' },
        { daysAhead: 2, time: 'akşam', text: 'Kinematik' },
        { daysAhead: 1, time: null, text: '   ' },
      ],
    }),
  });

  assertEquals(plan.reminders, [
    { date: TUESDAY, time: '09:00', text: 'Fizik ödevini teslim et' },
    { date: '2026-10-09', time: '21:30', text: 'Quiz' },
    { date: '2026-10-07', time: '09:00', text: 'Kinematik' },
  ]);
});

// ---------------------------------------------------------------------------
// Gruplar: gerçek raporlardan çıkan hatalar ve dağıtma, takas, sıralama, düzen
// ---------------------------------------------------------------------------
const YESTERDAY = '2026-10-04';
const group = (over: Partial<CheckinExtraction['taskGroups'][number]>): CheckinExtraction['taskGroups'][number] => ({
  parentTaskId: null,
  newParentTitle: null,
  childTaskIds: [],
  ...over,
});

Deno.test('"dünkü konsept ve feynmanı grupla ve bugüne al": öğrenme kartı adımlarıyla birlikte bugüne gelir', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [
      task('c', 'top-carnot', { type: 'concept_note', dueDate: YESTERDAY, estimatedMinutes: 30 }),
      task('f', 'top-carnot', { type: 'feynman', dueDate: YESTERDAY, estimatedMinutes: 30 }),
    ],
    topics,
    capacityByWeekday: WIDE,
    extraction: extraction({
      taskGroups: [group({ newParentTitle: 'Carnot: konsept ve Feynman', childTaskIds: ['c', 'f'] })],
      taskReschedules: [
        { taskId: 'c', dueInDays: 0 },
        { taskId: 'f', dueInDays: 0 },
      ],
    }),
  });

  const container = plan.newTasks.find((t) => t.id === plan.taskGroups[0]?.parent_task_id);
  // Before: the card stayed on Monday while its steps went to Tuesday.
  assertEquals([container?.type, container?.source, container?.due_date], ['learning', 'manual', TODAY]);
  assertEquals(plan.taskMoves.map((m) => [m.task_id, m.due_date]).sort(), [
    ['c', TODAY],
    ['f', TODAY],
  ]);
});

Deno.test('konsept sayfası Feynman\'ın üst görevi yapılmaz: ikisi yeni bir öğrenme kartına girer', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [
      task('c', 'top-truss', { type: 'concept_note', dueDate: TUESDAY }),
      task('f', 'top-truss', { type: 'feynman', dueDate: '2026-10-08' }),
    ],
    topics,
    capacityByWeekday: WIDE,
    extraction: extraction({ taskGroups: [group({ parentTaskId: 'c', childTaskIds: ['f'] })] }),
  });

  assertEquals(plan.taskGroups.length, 1);
  assertEquals([...(plan.taskGroups[0]?.child_task_ids ?? [])].sort(), ['c', 'f']);
  const container = plan.newTasks.find((t) => t.id === plan.taskGroups[0]?.parent_task_id);
  assertEquals([container?.type, container?.title], ['learning', 'Trusses — öğrenme görevi']);
  // One sitting, one day: the earlier of the two.
  assertEquals(plan.taskMoves.map((m) => [m.task_id, m.due_date]), [['f', TUESDAY]]);
  assertEquals(container?.due_date, TUESDAY);
});

Deno.test('öğrenme kartının bir adımını taşımak bütün kartı taşır; ödevin parçası tek başına gider', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [
      ...learningCard('L', 'top-truss', TUESDAY),
      task('hw', 'top-gauss', { dueDate: '2026-10-09', source: 'homework' }),
      task('hw-1', 'top-gauss', { dueDate: '2026-10-09', source: 'homework', parentTaskId: 'hw' }),
      task('hw-2', 'top-gauss', { dueDate: '2026-10-09', source: 'homework', parentTaskId: 'hw' }),
    ],
    topics,
    capacityByWeekday: WIDE,
    extraction: extraction({
      taskReschedules: [
        { taskId: 'L-f', dueInDays: 3 },
        { taskId: 'hw-1', dueInDays: 1 },
      ],
    }),
  });

  assertEquals(plan.taskMoves.map((m) => [m.task_id, m.due_date]).sort(), [
    ['L', '2026-10-08'],
    ['L-c', '2026-10-08'],
    ['L-f', '2026-10-08'],
    ['hw-1', TUESDAY],
  ]);
});

Deno.test('"grupları dağıt": kart adı da adımın adı da grubu bulur; grup olmayan görev yok sayılır', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [...learningCard('L', 'top-truss', TUESDAY), ...learningCard('M', 'top-carnot', TUESDAY), task('solo', 'top-gauss')],
    topics,
    extraction: extraction({
      taskUngroups: [{ taskId: 'L' }, { taskId: 'M-f' }, { taskId: 'solo' }, { taskId: 'L-c' }],
    }),
  });

  assertEquals(plan.taskUngroups, ['L', 'M']);
});

Deno.test('dağıtılan grubun adımları aynı raporda yeniden gruplanabilir', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [...learningCard('L', 'top-truss', TUESDAY), task('q', 'top-truss', { type: 'quiz', dueDate: TUESDAY })],
    topics,
    extraction: extraction({
      taskUngroups: [{ taskId: 'L' }],
      taskGroups: [group({ newParentTitle: 'Kafesler hepsi', childTaskIds: ['L-c', 'L-f', 'q'] })],
    }),
  });

  assertEquals([...(plan.taskGroups[0]?.child_task_ids ?? [])].sort(), ['L-c', 'L-f', 'q']);
});

Deno.test('"salı ile perşembeyi değiştir": kartlar yer değiştirir, teslimi geçecek ödev kalır', () => {
  const THURSDAY = '2026-10-08';
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [
      ...learningCard('L', 'top-truss', TUESDAY),
      task('hw', 'top-gauss', { dueDate: TUESDAY, source: 'homework', title: 'Fizik ödevi' }),
      task('q', 'top-carnot', { type: 'quiz', dueDate: THURSDAY }),
    ],
    topics,
    capacityByWeekday: WIDE,
    extraction: extraction({ daySwaps: [{ firstDaysAhead: 1, secondDaysAhead: 3 }] }),
  });

  assertEquals(plan.taskMoves.map((m) => [m.task_id, m.due_date]).sort(), [
    ['L', THURSDAY],
    ['L-c', THURSDAY],
    ['L-f', THURSDAY],
    ['q', TUESDAY],
  ]);
  assertEquals(plan.notes, ['"Fizik ödevi" teslimi Perşembe 8 Eki günden önce olduğu için yerinde kaldı.']);
});

Deno.test('"konu sırasına göre diz": günlerdeki kart sayısı aynı kalır, erken hafta öne gelir', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [
      // Week 2 topics early in the week, week 1 at its end.
      task('carnot', 'top-carnot', { type: 'concept_note', dueDate: TODAY }),
      task('gauss', 'top-gauss', { type: 'concept_note', dueDate: TUESDAY }),
      task('truss', 'top-truss', { type: 'concept_note', dueDate: '2026-10-09' }),
    ],
    topics,
    capacityByWeekday: WIDE,
    extraction: extraction({ syllabusOrders: [{ fromDaysAhead: 0, untilDaysAhead: 6, courseIds: [] }] }),
  });

  const dayOf = (id: string) => plan.taskMoves.find((m) => m.task_id === id)?.due_date ?? null;
  assertEquals(dayOf('truss'), TODAY);
  // The same three days still hold one card each.
  const days = ['carnot', 'gauss', 'truss'].map((id) => dayOf(id) ?? { carnot: TODAY, gauss: TUESDAY, truss: '2026-10-09' }[id]);
  assertEquals([...days].sort(), [TODAY, TUESDAY, '2026-10-09']);
  assertEquals(plan.schedule.syllabusOrders[0]?.moved, 2);
});

Deno.test('"haftayı düzenle": ayrı günlerdeki konsept ve Feynman tek öğrenme kartı olur', () => {
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks: [
      task('c', 'top-gauss', { type: 'concept_note', dueDate: TUESDAY, estimatedMinutes: 30 }),
      task('f', 'top-gauss', { type: 'feynman', dueDate: '2026-10-08', estimatedMinutes: 30 }),
    ],
    topics,
    capacityByWeekday: WIDE,
    extraction: extraction({ weekTidies: [{ fromDaysAhead: 0, untilDaysAhead: null }] }),
  });

  const container = plan.newTasks.find((t) => t.type === 'learning');
  assertEquals(container?.due_date, TUESDAY);
  assertEquals([...(plan.taskGroups[0]?.child_task_ids ?? [])].sort(), ['c', 'f']);
  assertEquals(plan.schedule.tidies[0]?.paired, 1);
});

Deno.test('geciken işler: "dağıt" önümüzdeki günlere taşır, "kapat" kaldırır', () => {
  const late = [task('late-1', 'top-truss', { dueDate: '2026-10-01' }), task('late-2', 'top-carnot', { dueDate: YESTERDAY })];

  const spread = planCheckinEffects({
    logDate: TODAY,
    tasks: [...late, task('today', 'top-gauss')],
    topics,
    capacityByWeekday: WIDE,
    extraction: extraction({ backlogActions: [{ action: 'spread' }] }),
  });
  assertEquals(spread.taskMoves.map((m) => m.task_id).sort(), ['late-1', 'late-2']);
  assertEquals(spread.taskMoves.every((m) => m.due_date >= TODAY), true);

  const close = planCheckinEffects({
    logDate: TODAY,
    tasks: late,
    topics,
    extraction: extraction({ backlogActions: [{ action: 'close' }] }),
  });
  assertEquals(close.taskRemovals.map((r) => r.task_id).sort(), ['late-1', 'late-2']);
});

Deno.test('"vize ilk hafta konularını kapsıyor": haftalar dersin konularına çevrilir, sonuç yeni listeyi okur', () => {
  const physicsExam = [{ id: 'e-p', courseId: 'c-statics', title: 'Statik vize', examDate: YESTERDAY }];
  const plan = planCheckinEffects({
    logDate: TODAY,
    tasks,
    topics,
    exams: physicsExam,
    examTopicIds: { 'e-p': ['top-carnot'] },
    extraction: extraction({
      examScopes: [{ examId: 'e-p', fromWeek: 1, untilWeek: 1, topicIds: [], replace: true }],
      examResults: [{ examId: 'e-p', outcome: 2, score: null, maxScore: null, hardTopicIds: [] }],
    }),
  });

  assertEquals(plan.examScopes, [{ exam_id: 'e-p', topic_ids: ['top-truss'], replace: true }]);
  // The result reads the list just set, not the one it replaced.
  assertEquals(plan.topicReviews.map((r) => r.topic_id), ['top-truss']);
});
