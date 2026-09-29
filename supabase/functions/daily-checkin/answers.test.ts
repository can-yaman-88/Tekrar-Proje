import { assertEquals } from 'jsr:@std/assert@1';
import type { CheckinExtraction } from '../_shared/contracts/daily-checkin.contract.ts';
import { answerQuestions } from './answers.ts';
import { describePlan } from './describe.ts';
import { type CandidateTask, type CandidateTopic, planCheckinEffects, type PlanInput } from './planner.ts';

const TODAY = '2026-10-05'; // Pazartesi
const TUESDAY = '2026-10-06';
const WIDE = { 1: 240, 2: 240, 3: 240, 4: 240, 5: 240, 6: 240, 7: 240 };
const srs = { easeFactor: 2.5, intervalDays: 6, repetitions: 2 };
const topics: CandidateTopic[] = [
  { id: 'top-truss', courseId: 'c-statics', title: 'Kafesler', courseName: 'Statik', weekNumber: 1, position: 0, srs },
  { id: 'top-gauss', courseId: 'c-phys', title: 'Gauss', courseName: 'Fizik 2', weekNumber: 2, position: 0, srs },
];
const courses = [
  { id: 'c-statics', name: 'Statik' },
  { id: 'c-phys', name: 'Fizik 2' },
];
const exams = [{ id: 'e-1', courseId: 'c-phys', title: 'Fizik vize', examDate: '2026-10-16' }];

const task = (id: string, over: Partial<CandidateTask> = {}): CandidateTask => ({
  id,
  topicId: 'top-truss',
  title: `Görev ${id}`,
  type: 'problem_set',
  status: 'pending',
  dueDate: TODAY,
  targetCount: null,
  completedCount: 0,
  estimatedMinutes: 30,
  instructions: null,
  source: 'ai_weekly_plan',
  parentTaskId: null,
  originExamId: null,
  isPriority: false,
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

const run = (input: Omit<PlanInput, 'logDate' | 'topics'>) => {
  const context = { tasks: input.tasks, topics, courses, exams, openMistakes: input.openMistakes ?? [] };
  const plan = planCheckinEffects({ logDate: TODAY, topics, courses, exams, capacityByWeekday: WIDE, ...input });
  return {
    plan,
    changes: describePlan({ plan, logDate: TODAY, ...context }),
    answers: answerQuestions({ questions: plan.questions, logDate: TODAY, plan, ...context }),
  };
};

// ---------------------------------------------------------------------------
// "Ne anladım" listesi
// ---------------------------------------------------------------------------
Deno.test('her değişiklik adıyla yazılır: toplu bitiş tek satır, taşınan gün, eklenen ödev', () => {
  const { changes } = run({
    tasks: [
      task('a', { title: 'Kafes problemleri' }),
      task('b', { title: 'Kafes Feynman' }),
      task('later', { title: 'Gauss seti', topicId: 'top-gauss', dueDate: '2026-10-08' }),
    ],
    extraction: extraction({
      bulkOutcomes: [{ daysAgo: null, outcome: 'completed', courseIds: [], exceptTaskIds: [] }],
      taskReschedules: [{ taskId: 'later', dueInDays: 1 }],
      plannedWork: [
        {
          topicId: 'top-gauss',
          title: 'Fizik ödevi',
          type: 'problem_set',
          problemCount: 8,
          isHomework: true,
          dueInDays: 4,
          dueDate: null,
          instructions: null,
          subtasks: [],
          replacesTaskIds: [],
        },
      ],
    }),
  });

  assertEquals(changes, [
    { kind: 'done', text: 'bugün: 2 görevin hepsi tamamlandı.' },
    { kind: 'added', text: 'Ödev eklendi: "Fizik ödevi" — teslim Cuma 9 Eki.' },
    { kind: 'moved', text: '"Gauss seti" → yarın.' },
  ]);
});

Deno.test('takılma, telafi günüyle birlikte söylenir; uyarılar listenin sonundadır', () => {
  const { changes } = run({
    tasks: [task('hw', { title: 'Statik ödevi', dueDate: TUESDAY, source: 'homework', estimatedMinutes: 90 }), task('f', { title: 'Kafes seti', targetCount: 10 })],
    extraction: extraction({
      taskOutcomes: [
        {
          taskId: 'f',
          outcome: 'failed',
          problemsSolved: 3,
          correctCount: null,
          daysAgo: null,
          correctsEarlierReport: false,
          confidence: 1,
          weakConcept: null,
          weakResolved: false,
          weakDetail: null,
        },
      ],
      dayLoads: [{ daysAhead: 1, untilDaysAhead: null, minutes: 60 }],
    }),
  });

  assertEquals(changes[0], { kind: 'struggle', text: '"Kafes seti": takıldın; telafi görevi yarın için eklendi.' });
  assertEquals(changes.at(-1), { kind: 'warning', text: 'yarın için söylediğin süre, o gün teslimi olan işe yetmiyor.' });
});

// ---------------------------------------------------------------------------
// Sorulara cevap: planın bu rapordan SONRAKİ hâlinden
// ---------------------------------------------------------------------------
Deno.test('"pazarı boşalt, yarın ne var?": cevap taşımadan sonraki planı okur', () => {
  const { answers } = run({
    tasks: [
      task('sun', { title: 'Pazar işi', dueDate: '2026-10-11', estimatedMinutes: 45 }),
      task('tue', { title: 'Salı işi', dueDate: TUESDAY, targetCount: 10, completedCount: 4 }),
      task('hw', { title: 'Fizik ödevi', topicId: 'top-gauss', dueDate: '2026-10-09', source: 'homework' }),
    ],
    extraction: extraction({
      dayClearances: [{ daysAhead: 6, untilDaysAhead: null, spreadFromDaysAhead: 1, everyWeek: false, reason: null }],
      infoRequests: [{ kind: 'day_agenda', daysAhead: 1 }],
    }),
  });

  assertEquals(answers, [
    {
      question: 'Yarın ne var? (Salı 6 Eki)',
      lines: [
        '2 görev · ~1 sa 15 dk',
        '• Pazar işi · ~45 dk',
        '• Salı işi · 6 soru · ~30 dk',
        'Teslimi yaklaşan: Fizik ödevi — Cuma 9 Eki',
      ],
    },
  ]);
});

Deno.test('sınav, geciken iş ve zayıf nokta soruları', () => {
  const { answers } = run({
    tasks: [task('late', { title: 'Eski set', dueDate: '2026-10-01' })],
    openMistakes: [{ id: 'm-1', topicId: 'top-gauss', body: 'akı yüzeyini ters seçtim' }],
    extraction: extraction({
      infoRequests: [
        { kind: 'exams', daysAhead: null },
        { kind: 'overdue', daysAhead: null },
        { kind: 'weak_spots', daysAhead: null },
      ],
    }),
  });

  assertEquals(answers.map((a) => a.lines[0]), [
    '• Fizik 2 · Fizik vize — Cuma 16 Eki · 11 gün',
    '1 görev · ~30 dk',
    '• Fizik 2 › Gauss: "akı yüzeyini ters seçtim"',
  ]);
});

Deno.test('soru yoksa cevap da yok', () => {
  assertEquals(run({ tasks: [task('a')], extraction: extraction({}) }).answers, []);
});

Deno.test('plan dışı çalışma, aciliyet, sınav planı ve hatırlatma tek satırlarla söylenir', () => {
  const { changes } = run({
    tasks: [
      task('hw', { title: 'Fizik ödevi', topicId: 'top-gauss' }),
      task('old-sprint', { topicId: 'top-gauss', source: 'exam_cram', originExamId: 'e-1' }),
    ],
    exams: [{ id: 'e-1', courseId: 'c-phys', title: 'Fizik vize', examDate: '2026-10-08' }],
    cramContexts: [
      {
        examId: 'e-1',
        topics: [{ id: 'top-gauss', title: 'Gauss', weekNumber: 2, position: 0, easeFactor: 2.5, repetitions: 0, nextReviewOn: null, completedSteps: [], recentFailures: 0 }],
      },
    ],
    extraction: extraction({
      extraWork: [{ topicId: 'top-truss', problemsSolved: 15, correctCount: 12, minutes: 40, daysAgo: null }],
      priorities: [{ taskId: 'hw', urgent: true }],
      examPlans: [{ examId: 'e-1' }],
      reminders: [{ daysAhead: 1, time: '09:00', text: 'Fizik ödevini teslim et' }],
    }),
  });

  assertEquals(changes.map((c) => c.text), [
    'Ek çalışma kaydedildi: Kafesler — 15 soru · 12 doğru · 40 dk (bugün).',
    // The sprint's three tasks are one line, not three.
    '"Görev old-sprint" kaldırıldı.',
    'Fizik vize için sınav planı: 3 adım, 1 güne yayıldı.',
    '"Fizik ödevi" acil olarak işaretlendi.',
    'Hatırlatma: yarın 09.00 — Fizik ödevini teslim et',
  ]);
});
