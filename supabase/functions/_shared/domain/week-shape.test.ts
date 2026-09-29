import { assertEquals } from 'jsr:@std/assert@1';
import { planWeekShape, type ShapeDay, type ShapeTask } from './week-shape.ts';

const MONDAY = '2026-10-05';
const day = (date: string, capacity = 240, maxMainTasks: number | null = null): ShapeDay => ({
  date,
  capacityMinutes: capacity,
  maxMainTasks,
});

/** Monday to Friday, roomy unless a test says otherwise. */
const week = (capacity = 240, maxMainTasks: number | null = null): ShapeDay[] =>
  ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map((date) =>
    day(date, capacity, maxMainTasks),
  );

const task = (over: Partial<ShapeTask> & Pick<ShapeTask, 'id' | 'dueDate'>): ShapeTask => ({
  topicId: 'top-1',
  step: null,
  estimatedMinutes: 30,
  parentId: null,
  hasDeadline: false,
  isMovable: true,
  ...over,
});

Deno.test('konsept ile Feynman aynı güne toplanır, erken gün kazanır', () => {
  const plan = planWeekShape({
    today: MONDAY,
    days: week(),
    tasks: [
      task({ id: 'concept', dueDate: '2026-10-05', step: 'concept_note' }),
      task({ id: 'feynman', dueDate: '2026-10-07', step: 'feynman' }),
    ],
  });

  assertEquals(plan.moves, [
    { taskId: 'feynman', unitId: 'feynman', from: '2026-10-07', to: '2026-10-05', reason: 'pair' },
  ]);
});

Deno.test('Feynman\'dan önceye düşmüş sınav Feynman\'ın gününe çekilir', () => {
  const plan = planWeekShape({
    today: MONDAY,
    days: week(),
    tasks: [
      task({ id: 'concept', dueDate: '2026-10-06', step: 'concept_note' }),
      task({ id: 'feynman', dueDate: '2026-10-06', step: 'feynman' }),
      // Sınav, Feynman'dan önce duruyor: raporun boşalttığı günden buraya düşmüş.
      task({ id: 'quiz', dueDate: '2026-10-05', step: 'quiz' }),
    ],
  });

  // The same day is allowed now: the first day that is not before the page.
  assertEquals(plan.moves, [
    { taskId: 'quiz', unitId: 'quiz', from: '2026-10-05', to: '2026-10-06', reason: 'quiz_after_feynman' },
  ]);
});

Deno.test('Feynman\'la aynı gündeki sınav yerinde kalır', () => {
  const plan = planWeekShape({
    today: MONDAY,
    days: week(),
    tasks: [
      task({ id: 'feynman', dueDate: '2026-10-06', step: 'feynman' }),
      task({ id: 'quiz', dueDate: '2026-10-06', step: 'quiz' }),
    ],
  });

  assertEquals(plan.moves, []);
});

Deno.test('ileri seviye sorular sınavdan sonraya gider', () => {
  const plan = planWeekShape({
    today: MONDAY,
    days: week(),
    tasks: [
      task({ id: 'quiz', dueDate: '2026-10-07', step: 'quiz' }),
      task({ id: 'advanced', dueDate: '2026-10-06', step: 'advanced_problems' }),
    ],
  });

  assertEquals(plan.moves.map((m) => [m.taskId, m.to, m.reason]), [
    ['advanced', '2026-10-08', 'advanced_after_quiz'],
  ]);
});

Deno.test('kuralların hepsine uyan hafta hiç hareket üretmez', () => {
  const plan = planWeekShape({
    today: MONDAY,
    days: week(),
    tasks: [
      task({ id: 'concept', dueDate: '2026-10-05', step: 'concept_note' }),
      task({ id: 'feynman', dueDate: '2026-10-05', step: 'feynman' }),
      task({ id: 'quiz', dueDate: '2026-10-06', step: 'quiz' }),
    ],
  });

  assertEquals(plan.moves, []);
  assertEquals(plan.notes, []);
});

Deno.test('öğrenme görevi ve adımları birlikte taşınır', () => {
  const plan = planWeekShape({
    today: MONDAY,
    days: week(),
    tasks: [
      task({ id: 'parent', dueDate: '2026-10-06', step: null, estimatedMinutes: 0 }),
      task({ id: 'concept', dueDate: '2026-10-06', step: 'concept_note', parentId: 'parent' }),
      task({ id: 'feynman', dueDate: '2026-10-06', step: 'feynman', parentId: 'parent' }),
      // Sınav önde: onu değil, kendi gününü koruyan öğrenme görevini örnek alır.
      task({ id: 'quiz', dueDate: '2026-10-05', step: 'quiz' }),
    ],
  });

  // Kartın gününe gider: sınav Feynman'la aynı gün olabilir.
  assertEquals(plan.moves.map((m) => m.taskId), ['quiz']);
  assertEquals(plan.moves[0]?.to, '2026-10-06');
});

Deno.test('gün başına ana görev sınırı fazlalığı sonraki güne taşır', () => {
  const plan = planWeekShape({
    today: MONDAY,
    days: [day('2026-10-05', 300, 2), day('2026-10-06', 300, null), day('2026-10-07', 300, null)],
    tasks: [
      task({ id: 'a', dueDate: '2026-10-05', topicId: 'top-a', step: 'concept_note' }),
      task({ id: 'b', dueDate: '2026-10-05', topicId: 'top-b', step: 'feynman' }),
      task({ id: 'c', dueDate: '2026-10-05', topicId: 'top-c', step: 'quiz' }),
    ],
  });

  // Döngüde en geç adım gününü bırakır: sınav.
  assertEquals(plan.moves.map((m) => [m.taskId, m.to, m.reason]), [['c', '2026-10-06', 'day_cap']]);
});

Deno.test('gün sınırı, teslim tarihli işi en son taşır', () => {
  const plan = planWeekShape({
    today: MONDAY,
    days: [day('2026-10-05', 300, 1), day('2026-10-06', 300, null)],
    tasks: [
      task({ id: 'odev', dueDate: '2026-10-05', hasDeadline: true }),
      task({ id: 'quiz', dueDate: '2026-10-05', step: 'quiz' }),
    ],
  });

  assertEquals(plan.moves.map((m) => m.taskId), ['quiz']);
});

Deno.test('teslim tarihli iş teslimden sonraya atılmaz', () => {
  const plan = planWeekShape({
    today: MONDAY,
    days: [day('2026-10-05', 60, null), day('2026-10-06', 300, null)],
    tasks: [
      task({ id: 'odev', dueDate: '2026-10-05', hasDeadline: true, estimatedMinutes: 90 }),
    ],
  });

  // Gün kapasitesi aşılıyor ama teslim bugün: taşınmaz, söylenir.
  assertEquals(plan.moves, []);
  assertEquals(plan.notes.length, 1);
});

Deno.test('kapasite aşan gün bir sonraki güne boşalır', () => {
  const plan = planWeekShape({
    today: MONDAY,
    days: [day('2026-10-05', 60), day('2026-10-06', 120)],
    tasks: [
      task({ id: 'a', dueDate: '2026-10-05', topicId: 'top-a', estimatedMinutes: 45, step: 'concept_note' }),
      task({ id: 'b', dueDate: '2026-10-05', topicId: 'top-b', estimatedMinutes: 45, step: 'quiz' }),
    ],
  });

  assertEquals(plan.moves.map((m) => [m.taskId, m.to, m.reason]), [['b', '2026-10-06', 'capacity']]);
});

Deno.test('taşınamayan görev yerinde kalır ve durum bildirilir', () => {
  const plan = planWeekShape({
    today: MONDAY,
    days: week(),
    tasks: [
      task({ id: 'feynman', dueDate: '2026-10-07', step: 'feynman' }),
      task({ id: 'quiz', dueDate: '2026-10-06', step: 'quiz', isMovable: false }),
    ],
  });

  assertEquals(plan.moves, []);
  assertEquals(plan.notes, ['Sınavı Feynman gününe ya da sonrasına alacak yer kalmadı.']);
});

Deno.test('aynı güne düşen dokunulmamış çift, öğrenme görevi adayı olur', () => {
  const plan = planWeekShape({
    today: MONDAY,
    days: week(),
    tasks: [
      task({ id: 'concept', dueDate: '2026-10-05', step: 'concept_note' }),
      task({ id: 'feynman', dueDate: '2026-10-07', step: 'feynman' }),
    ],
    groupExistingPairs: true,
  });

  assertEquals(plan.pairings, [
    { topicId: 'top-1', conceptTaskId: 'concept', feynmanTaskId: 'feynman', date: '2026-10-05' },
  ]);
});

Deno.test('zaten gruplanmış çift için yeni öğrenme görevi önerilmez', () => {
  const plan = planWeekShape({
    today: MONDAY,
    days: week(),
    tasks: [
      task({ id: 'parent', dueDate: '2026-10-05', estimatedMinutes: 0 }),
      task({ id: 'concept', dueDate: '2026-10-05', step: 'concept_note', parentId: 'parent' }),
      task({ id: 'feynman', dueDate: '2026-10-05', step: 'feynman', parentId: 'parent' }),
    ],
    groupExistingPairs: true,
  });

  assertEquals(plan.pairings, []);
  assertEquals(plan.moves, []);
});

Deno.test('gün listesi boşsa hiçbir şey yapılmaz', () => {
  const plan = planWeekShape({
    today: MONDAY,
    days: [],
    tasks: [task({ id: 'a', dueDate: '2026-10-05', step: 'quiz' })],
  });

  assertEquals(plan, { moves: [], pairings: [], notes: [] });
});
