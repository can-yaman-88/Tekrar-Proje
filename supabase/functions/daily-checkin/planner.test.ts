import { assertEquals } from 'jsr:@std/assert@1';
import type { CheckinExtraction } from '../_shared/contracts/daily-checkin.contract.ts';
import { type CandidateTask, type CandidateTopic, planCheckinEffects } from './planner.ts';

const TODAY = '2026-10-05';
const srs = { easeFactor: 2.5, intervalDays: 6, repetitions: 2 };

const topics: CandidateTopic[] = [
  { id: 'top-truss', title: 'Trusses', courseName: 'Statics', weekNumber: 1, srs },
  { id: 'top-carnot', title: 'Carnot cycle', courseName: 'Thermodynamics', weekNumber: 2, srs },
  { id: 'top-gauss', title: "Gauss's law", courseName: 'Physics 2', weekNumber: 2, srs },
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
  topicStruggles: [],
  unmatchedMentions: [],
  attachmentTasks: [],
  advancedMaterialTopics: [],
  taskRemovals: [],
  plannedWork: [],
  taskBreakdowns: [],
  dayClearances: [],
  taskReschedules: [],
  taskEdits: [],
  taskGroups: [],
  taskNotes: [],
  timeLogs: [],
  examChanges: [],
  mistakeResolutions: [],
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
        { action: 'update', examId: 'e-mid', courseId: null, kind: null, title: null, dateInDays: 21 },
        { action: 'insert', examId: null, courseId: 'c-phys', kind: 'quiz', title: null, dateInDays: 7 },
        { action: 'delete', examId: 'e-mid', courseId: null, kind: null, title: null, dateInDays: null },
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
        { action: 'insert', examId: null, courseId: 'c-phys', kind: null, title: 'Tarihi yok', dateInDays: null },
        { action: 'update', examId: 'e-mid', courseId: null, kind: null, title: null, dateInDays: null },
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
