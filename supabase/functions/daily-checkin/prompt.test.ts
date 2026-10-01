import { assertEquals } from 'jsr:@std/assert@1';
import type { CheckinExtraction } from '../_shared/contracts/daily-checkin.contract.ts';
import { Aliases } from './aliases.ts';
import { selectCandidateTasks, type SelectableTask } from './candidates.ts';
import type { CandidateTask, CandidateTopic } from './planner.ts';
import { buildUserPrompt, calendarBlock } from './prompt.ts';
import { salvageExtraction } from './salvage.ts';

const LOG_DATE = '2026-09-29'; // Salı
const srs = { easeFactor: 2.5, intervalDays: 1, repetitions: 0 };
const topics: CandidateTopic[] = [
  { id: '11111111-aaaa-4000-8000-000000000001', courseId: 'c0ffee00-0000-4000-8000-000000000001', title: 'Kafesler', courseName: 'Statik', weekNumber: 1, position: 0, srs },
];
const task = (id: string, over: Partial<CandidateTask> = {}): CandidateTask => ({
  id,
  topicId: topics[0]!.id,
  title: 'Kafes problemleri',
  type: 'problem_set',
  status: 'pending',
  dueDate: LOG_DATE,
  targetCount: 30,
  completedCount: 0,
  estimatedMinutes: 60,
  instructions: null,
  source: 'ai_weekly_plan',
  parentTaskId: null,
  originExamId: null,
  isPriority: false,
  ...over,
});

// ---------------------------------------------------------------------------
// Kısa tutamaçlar
// ---------------------------------------------------------------------------
Deno.test('istem UUID taşımaz; modelin tutamaçları gerçek kimliğe döner', () => {
  const parent = task('aaaaaaaa-0000-4000-8000-00000000000a', { type: 'learning', title: 'Kafesler öğrenme' });
  const step = task('bbbbbbbb-0000-4000-8000-00000000000b', { type: 'feynman', parentTaskId: parent.id });
  const { prompt, aliases } = buildUserPrompt({ logDate: LOG_DATE, report: 'bitirdim', tasks: [parent, step], topics });

  assertEquals(/[0-9a-f]{8}-[0-9a-f]{4}-/.test(prompt), false);
  assertEquals(prompt.includes('T2 | Statik › Kafesler (hafta 1) | feynman'), true);
  assertEquals(prompt.includes('step of T1'), true);
  assertEquals(prompt.includes('K1 | D1 Statik | Kafesler | hafta 1'), true);

  const answer = {
    taskOutcomes: [{ taskId: 't2', outcome: 'completed' }],
    plannedWork: [{ topicId: 'K1', replacesTaskIds: ['T1', 'T99'] }],
    bulkOutcomes: [{ courseIds: ['D1'], exceptTaskIds: [] }],
    summary: 'T1 bitti',
  };
  assertEquals(aliases.resolve(answer), {
    taskOutcomes: [{ taskId: step.id, outcome: 'completed' }],
    plannedWork: [{ topicId: topics[0]!.id, replacesTaskIds: [parent.id, 'T99'] }],
    bulkOutcomes: [{ courseIds: [topics[0]!.courseId], exceptTaskIds: [] }],
    // Only id fields are translated; the student's words are left alone.
    summary: 'T1 bitti',
  });
});

Deno.test('aynı kimlik hep aynı tutamacı alır', () => {
  const aliases = new Aliases();
  assertEquals([aliases.of('T', 'x'), aliases.of('T', 'y'), aliases.of('T', 'x'), aliases.of('K', 'z')], [
    'T1',
    'T2',
    'T1',
    'K1',
  ]);
});

// ---------------------------------------------------------------------------
// Takvim
// ---------------------------------------------------------------------------
Deno.test('takvim günleri sayı ile eşler: model saymaz, bakar', () => {
  const rows = calendarBlock(LOG_DATE);
  assertEquals(rows.includes('daysAgo 1 = Pazartesi 28 Eyl (dün)'), true);
  assertEquals(rows.includes('0 = Salı 29 Eyl — REPORT DATE (bugün)'), true);
  assertEquals(rows.includes('daysAhead 1 = Çarşamba 30 Eyl (yarın)'), true);
  assertEquals(rows.includes('daysAhead 5 = Pazar 4 Eki'), true);
  assertEquals(rows.at(-1), 'daysAhead 14 = Salı 13 Eki');
});

Deno.test('görev satırı gününü takvimin sayısıyla söyler', () => {
  const { prompt } = buildUserPrompt({
    logDate: LOG_DATE,
    report: 'x',
    tasks: [task('t-1', { dueDate: '2026-09-27' }), task('t-2', { dueDate: '2026-10-01', source: 'homework' })],
    topics,
  });
  assertEquals(prompt.includes('Pazar 27 Eyl (daysAgo 2)'), true);
  assertEquals(prompt.includes('Perşembe 1 Eki (daysAhead 2) | 0/30 done | pending | ödev'), true);
});

// ---------------------------------------------------------------------------
// Hangi görevler gösterilir
// ---------------------------------------------------------------------------
const row = (id: string, dueDate: string, over: Partial<SelectableTask> = {}): SelectableTask => ({
  id,
  parentTaskId: null,
  title: `Görev ${id}`,
  dueDate,
  status: 'pending',
  ...over,
});

Deno.test('sınır dolduğunda geçmiş iki haftanın bitenleri değil, önümüzdeki hafta seçilir', () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => row(`old-${i}`, '2026-09-16', { status: 'completed' })),
    row('today', LOG_DATE),
    row('next-week', '2026-10-05'),
  ];
  const chosen = selectCandidateTasks({ rows, logDate: LOG_DATE, report: 'bugün', limit: 3 });
  assertEquals(chosen.map((r) => r.id).includes('next-week'), true);
  assertEquals(chosen.map((r) => r.id).includes('today'), true);
});

Deno.test('raporda adı geçen eski görev öne alınır; kart bütün seçilir', () => {
  const rows = [
    row('carnot', '2026-09-17', { status: 'completed', title: 'Carnot seti' }),
    row('near-1', LOG_DATE),
    row('near-2', LOG_DATE),
    row('card', '2026-09-30'),
    row('card-step', '2026-09-30', { parentTaskId: 'card' }),
  ];
  const chosen = selectCandidateTasks({ rows, logDate: LOG_DATE, report: "Carnot'ta aslında 20 soru çözmüştüm", limit: 4 });
  const ids = chosen.map((r) => r.id);
  assertEquals(ids.includes('carnot'), true);
  // Three slots left: the card needs two, so it goes in whole or not at all.
  assertEquals(ids.includes('card') === ids.includes('card-step'), true);
});

// ---------------------------------------------------------------------------
// Bozuk bir maddenin bütün raporu düşürmemesi
// ---------------------------------------------------------------------------
Deno.test('şemaya uymayan tek madde atılır, gerisi kalır', () => {
  const salvaged = salvageExtraction({
    summary: 'Kafesleri bitirdi.',
    taskOutcomes: [
      { taskId: 'T1', outcome: 'done' }, // unknown outcome, missing fields
      {
        taskId: 'T2',
        outcome: 'completed',
        problemsSolved: null,
        correctCount: null,
        daysAgo: null,
        correctsEarlierReport: false,
        confidence: 4,
        weakConcept: null,
        weakResolved: false,
        weakDetail: null,
      },
    ],
    // Every other list is missing altogether.
  });

  assertEquals(salvaged?.droppedItems, 1);
  assertEquals(salvaged?.data.taskOutcomes.map((o) => o.taskId), ['T2']);
  assertEquals(salvaged?.data.infoRequests, [] as CheckinExtraction['infoRequests']);
  assertEquals(salvaged?.data.summary, 'Kafesleri bitirdi.');
});

Deno.test('nesne olmayan cevap kurtarılmaz', () => {
  assertEquals(salvageExtraction([1, 2]), null);
  assertEquals(salvageExtraction(null), null);
});

// ---------------------------------------------------------------------------
// İki okuyucu
// ---------------------------------------------------------------------------
Deno.test('iki okuyucunun şemaları birleşik çıkarımı tam olarak paylaşır', async () => {
  const { CheckinExtractionSchema, CheckinPlanSchema, CheckinProgressSchema } = await import(
    '../_shared/contracts/daily-checkin.contract.ts'
  );
  const progress = Object.keys(CheckinProgressSchema.shape);
  const planKeys = Object.keys(CheckinPlanSchema.shape);
  // No field read twice, none read by nobody.
  assertEquals(progress.filter((key) => planKeys.includes(key)), []);
  assertEquals([...progress, ...planKeys].sort(), Object.keys(CheckinExtractionSchema.shape).sort());
});

Deno.test('okunamayan "geri al" bayrağı kaldırılmış sayılmaz', async () => {
  const { CheckinPlanSchema } = await import('../_shared/contracts/daily-checkin.contract.ts');
  const { salvageWith } = await import('./salvage.ts');
  const salvaged = salvageWith(CheckinPlanSchema)({ undoPreviousReport: 'evet', reminders: [{ daysAhead: 1 }] });
  assertEquals(salvaged?.data.undoPreviousReport, false);
  assertEquals(salvaged?.droppedItems, 1);
});
