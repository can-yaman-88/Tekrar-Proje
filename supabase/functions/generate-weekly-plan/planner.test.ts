import { assertEquals } from 'jsr:@std/assert@1';
import { planWeek, type PlanExam, type PlanTopic } from './planner.ts';

const MONDAY = '2026-09-21';
const WEDNESDAY = '2026-09-23';
const FRIDAY = '2026-09-25';

const topic = (id: string, over: Partial<PlanTopic> = {}): PlanTopic => ({
  id,
  title: `Konu ${id}`,
  courseId: 'c1',
  courseLabel: 'ME 201',
  weekNumber: 1,
  easeFactor: 2.5,
  repetitions: 2,
  nextReviewOn: null,
  lastReviewedAt: '2026-09-01T10:00:00Z',
  completedSteps: [],
  openSteps: [],
  recentFailures: 0,
  hasAdvancedMaterial: false,
  hasTeacherMaterial: false,
  ...over,
});

const exam = (over: Partial<PlanExam> = {}): PlanExam => ({
  id: 'e1',
  courseId: 'c1',
  kind: 'midterm',
  title: 'Vize 1',
  examDate: '2026-09-25',
  topicIds: [],
  ...over,
});

Deno.test('görevler dersin işlendiği günlere dağıtılır', () => {
  const { slots } = planWeek({
    weekStart: MONDAY,
    topics: [topic('a')],
    exams: [],
    courseClassDays: { c1: [3, 5] }, // çarşamba, cuma
  });
  // Konsept ve Feynman aynı oturum: ikisi de çarşamba. Sınav araya girmez,
  // cumaya kalır — aradan geçen zaman onu hatırlama testi yapar.
  assertEquals(slots.map((s) => s.step), ['concept_note', 'feynman', 'quiz']);
  assertEquals(slots.map((s) => s.dueDate), [WEDNESDAY, WEDNESDAY, FRIDAY]);
  assertEquals(slots.every((s) => s.dueDate !== MONDAY), true);
});

Deno.test('ders günleri adımlar arasında sırayı bozmaz', () => {
  const { slots } = planWeek({
    weekStart: MONDAY,
    topics: [topic('a')],
    exams: [],
    courseClassDays: { c1: [3, 5] },
  });
  const dates = slots.map((s) => s.dueDate);
  assertEquals(
    dates.every((date, i) => i === 0 || date >= (dates[i - 1] ?? '')),
    true,
  );
  assertEquals(dates[0], WEDNESDAY);
});

Deno.test('ileri seviye materyal varsa aynı turda dördüncü görev eklenir', () => {
  const { slots } = planWeek({
    weekStart: MONDAY,
    topics: [topic('a', { hasAdvancedMaterial: true })],
    exams: [],
    dailyCapacityMinutes: 400,
  });
  assertEquals(slots.map((s) => s.step), ['concept_note', 'feynman', 'quiz', 'advanced_problems']);
});

Deno.test('ileri seviye materyal yoksa üç görev kalır', () => {
  const { slots } = planWeek({ weekStart: MONDAY, topics: [topic('a')], exams: [], dailyCapacityMinutes: 400 });
  assertEquals(slots.map((s) => s.step), ['concept_note', 'feynman', 'quiz']);
});

Deno.test('laboratuvar saati ders günü sayılmaz, yalnızca günü meşgul eder', () => {
  const { slots } = planWeek({
    weekStart: MONDAY,
    topics: [topic('a')],
    exams: [],
    // Laboratuvar pazartesi; ders çarşamba. Repository lab'ı courseClassDays'e koymaz.
    courseClassDays: { c1: [3] },
    classLoad: { 1: 240 },
    dailyCapacityMinutes: 120,
  });
  assertEquals(slots.some((s) => s.dueDate === MONDAY), false);
  assertEquals(slots[0]?.dueDate, WEDNESDAY);
});

Deno.test('quiz ve laboratuvar sınavları planlamayı etkilemez', () => {
  const quizWeek = planWeek({
    weekStart: MONDAY,
    topics: [topic('a')],
    exams: [exam({ kind: 'quiz', examDate: WEDNESDAY }), exam({ id: 'e2', kind: 'lab', examDate: FRIDAY })],
    courseClassDays: { c1: [3, 5] },
  });
  // Quiz günü boşaltılmaz, görevler yine çarşambadan başlar.
  assertEquals(quizWeek.slots[0]?.dueDate, WEDNESDAY);
  // Quiz baskısı 'exam' gerekçesi üretmez.
  assertEquals(quizWeek.slots.every((s) => s.reason !== 'exam'), true);
});

Deno.test('vize günü boş bırakılır ama deneme görevi üretilmez', () => {
  const { slots } = planWeek({
    weekStart: MONDAY,
    topics: [topic('a')],
    exams: [exam({ examDate: WEDNESDAY, topicIds: ['a'] })],
    courseClassDays: { c1: [3, 5] },
  });
  assertEquals(slots.some((s) => s.dueDate === WEDNESDAY), false);
  assertEquals(slots.every((s) => ['concept_note', 'quiz', 'feynman', 'advanced_problems'].includes(s.step)), true);
  assertEquals(slots[0]?.reason, 'exam'); // yaklaşan vize önceliği yükseltir
});

Deno.test('tekrar zamanı gelen konu Feynman + sınav ikilisi alır', () => {
  const { slots } = planWeek({
    weekStart: MONDAY,
    topics: [
      topic('a', { completedSteps: ['concept_note', 'quiz', 'feynman'], nextReviewOn: '2026-09-24' }),
    ],
    exams: [],
  });
  assertEquals(slots.map((s) => s.step), ['feynman', 'quiz']);
  assertEquals(slots[0]?.title.startsWith('Tekrar:'), true);
});

Deno.test('açık görevi olan adım ikinci kez planlanmaz', () => {
  const { slots } = planWeek({
    weekStart: MONDAY,
    // Konsept bitti, sıradaki adım olan Feynman'ın açık görevi var: döngü durur.
    topics: [topic('a', { completedSteps: ['concept_note'], openSteps: ['feynman'] })],
    exams: [],
  });
  assertEquals(slots.length, 0);
});

Deno.test('ders günleri dolunca kalan adımlar diğer günlere taşınır ve bildirilir', () => {
  const { slots, notes } = planWeek({
    weekStart: MONDAY,
    topics: [topic('a'), topic('b'), topic('c')],
    exams: [],
    courseClassDays: { c1: [3] }, // yalnızca çarşamba
    dailyCapacityMinutes: 60,
  });
  assertEquals(slots.some((s) => s.dueDate !== WEDNESDAY), true);
  assertEquals(notes.some((n) => n.includes('diğer günlerine')), true);
});

Deno.test('gün bazlı kapasite kullanılır: yoğun güne az, boş güne çok iş düşer', () => {
  const { slots } = planWeek({
    weekStart: MONDAY,
    topics: [topic('a'), topic('b'), topic('c')],
    exams: [],
    // Pazartesi neredeyse hiç çalışılmıyor, cumartesi bol vakit var.
    capacityByWeekday: { 1: 30, 2: 60, 3: 60, 4: 60, 5: 60, 6: 240, 7: 60 },
  });
  const minutesOn = (date: string) =>
    slots.filter((s) => s.dueDate === date).reduce((sum, s) => sum + s.estimatedMinutes, 0);
  assertEquals(minutesOn(MONDAY) <= 30, true);
  assertEquals(minutesOn('2026-09-26') <= 60, true); // cuma
});

Deno.test('ödev haftanın kapasitesinden önce pay alır', () => {
  const topic = (id: string, courseId: string): PlanTopic => ({
    id,
    title: `Konu ${id}`,
    courseId,
    courseLabel: 'ME201',
    weekNumber: 1,
    easeFactor: 2.5,
    repetitions: 0,
    nextReviewOn: null,
    lastReviewedAt: null,
    completedSteps: [],
    openSteps: [],
    recentFailures: 0,
    hasAdvancedMaterial: false,
    hasTeacherMaterial: false,
  });

  const input = {
    weekStart: '2026-09-28' as const,
    topics: [topic('t1', 'c1'), topic('t2', 'c1')],
    exams: [],
    capacityByWeekday: { 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 60, 7: 60 },
  };

  const withoutHomework = planWeek(input);
  const withHomework = planWeek({
    ...input,
    commitments: [{ id: 'odev', dueDate: '2026-09-30', startsOn: null, remainingMinutes: 120 }],
  });

  const minutesBeforeDeadline = (result: ReturnType<typeof planWeek>): number =>
    result.slots
      .filter((slot) => slot.dueDate <= '2026-09-30')
      .reduce((total, slot) => total + slot.estimatedMinutes, 0);

  // Ödevin payı ilk üç günden düşülür; döngü o günlere daha az iş koyar.
  assertEquals(minutesBeforeDeadline(withHomework) < minutesBeforeDeadline(withoutHomework), true);
  assertEquals(
    withHomework.notes.some((note) => note.includes('Ödevler için')),
    true,
  );
});

Deno.test('kapasite dolduğunda ödev döngü adımlarını haftaya sığmaz hale getirir', () => {
  const topic = (id: string): PlanTopic => ({
    id,
    title: `Konu ${id}`,
    courseId: 'c1',
    courseLabel: 'ME201',
    weekNumber: 1,
    easeFactor: 2.5,
    repetitions: 0,
    nextReviewOn: null,
    lastReviewedAt: null,
    completedSteps: [],
    openSteps: [],
    recentFailures: 0,
    hasAdvancedMaterial: false,
    hasTeacherMaterial: false,
  });

  const input = {
    weekStart: '2026-09-28' as const,
    topics: [topic('t1'), topic('t2'), topic('t3'), topic('t4')],
    exams: [],
    capacityByWeekday: { 1: 40, 2: 40, 3: 40, 4: 40, 5: 40, 6: 40, 7: 40 },
  };

  const withoutHomework = planWeek(input);
  const withHomework = planWeek({
    ...input,
    commitments: [{ id: 'odev', dueDate: '2026-10-04', startsOn: null, remainingMinutes: 150 }],
  });

  assertEquals(withHomework.slots.length < withoutHomework.slots.length, true);
  assertEquals(
    withHomework.notes.some((note) => note.includes('sığmadı')),
    true,
  );
});

Deno.test('konsept ve Feynman aynı güne, sınav kesinlikle sonraki güne düşer', () => {
  const { slots } = planWeek({
    weekStart: MONDAY,
    topics: [topic('a')],
    exams: [],
    dailyCapacityMinutes: 400,
  });

  const dayOf = (step: string) => slots.find((s) => s.step === step)?.dueDate;
  assertEquals(dayOf('concept_note'), dayOf('feynman'));
  assertEquals((dayOf('quiz') ?? '') > (dayOf('feynman') ?? ''), true);
});

Deno.test('ikisi bir güne sığmazsa ayrılır ve bu bildirilir', () => {
  const { slots, notes } = planWeek({
    weekStart: MONDAY,
    topics: [topic('a')],
    exams: [],
    // Konsept 30, Feynman 25 dakika: 40 dakikalık gün ikisini birden kaldıramaz.
    dailyCapacityMinutes: 40,
  });

  const dayOf = (step: string) => slots.find((s) => s.step === step)?.dueDate;
  assertEquals(dayOf('concept_note') === dayOf('feynman'), false);
  assertEquals(notes.some((n) => n.includes('aynı güne sığmadı')), true);
});

Deno.test('kapalı güne hiç iş düşmez — kapasitesi sıfır olsa bile yarım saate yuvarlanmaz', () => {
  const { slots } = planWeek({
    weekStart: MONDAY,
    topics: ['a', 'b', 'c', 'd'].map((id) => topic(id)),
    exams: [],
    capacityByWeekday: { 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 60, 7: 0 },
    blockedWeekdays: [7],
  });
  const SUNDAY = '2026-09-27';
  assertEquals(slots.length > 0, true);
  assertEquals(slots.some((s) => s.dueDate === SUNDAY), false);
});

Deno.test('tekrar, vadesi gelmeden önceki bir güne konmaz', () => {
  const THURSDAY = '2026-09-24';
  const { slots } = planWeek({
    weekStart: MONDAY,
    topics: [topic('a', { completedSteps: ['concept_note', 'quiz', 'feynman'], nextReviewOn: THURSDAY })],
    exams: [],
    dailyCapacityMinutes: 400,
  });
  assertEquals(slots.map((s) => [s.step, s.dueDate >= THURSDAY]), [
    ['feynman', true],
    ['quiz', true],
  ]);
  // Sınav yine Feynman'dan sonraki güne kalır.
  assertEquals((slots[1]?.dueDate ?? '') > (slots[0]?.dueDate ?? ''), true);
});

Deno.test('öğrenilmiş bütçeden ders saati ikinci kez düşülmez', () => {
  const plan = (source: 'learned' | 'default') =>
    planWeek({
      weekStart: MONDAY,
      topics: [topic('a')],
      exams: [],
      courseClassDays: { c1: [1] },
      // Pazartesi 6 saat ders; öğrenci pazartesileri gerçekten 60 dakika çalışıyor.
      classLoad: { 1: 360 },
      capacityByWeekday: { 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 60, 7: 60 },
      capacitySources: { 1: source, 2: source, 3: source, 4: source, 5: source, 6: source, 7: source },
    });

  // Ölçülmüş 60 dakika, konsept + Feynman (55 dk) için pazartesi yeterli.
  assertEquals(plan('learned').slots[0]?.dueDate, MONDAY);
  // Tahmini bütçede 6 saatlik ders günü tabana iner, iş başka güne kayar.
  assertEquals(plan('default').slots[0]?.dueDate === MONDAY, false);
});

Deno.test('henüz işlenmemiş haftanın konusu plana girmez, işlenmiş olan girer', () => {
  // Dönem 14 Eylül'de başladı: 21 Eylül haftası 2. hafta.
  const { slots, notes } = planWeek({
    weekStart: MONDAY,
    topics: [topic('w2', { weekNumber: 2 }), topic('w5', { weekNumber: 5 })],
    exams: [],
    termStartByCourse: { c1: '2026-09-14' },
    dailyCapacityMinutes: 400,
  });
  assertEquals([...new Set(slots.map((s) => s.topicId))], ['w2']);
  assertEquals(notes.some((note) => note.includes('henüz işlenmediği')), true);
});

Deno.test('ileri haftanın konusuna öğrenci zaten başladıysa geri tutulmaz', () => {
  const { slots } = planWeek({
    weekStart: MONDAY,
    topics: [topic('w5', { weekNumber: 5, completedSteps: ['concept_note'] })],
    exams: [],
    termStartByCourse: { c1: '2026-09-14' },
    dailyCapacityMinutes: 400,
  });
  assertEquals(slots.length > 0, true);
});

Deno.test('bu hafta işlenecek konu dersin ilk gününden önceye konmaz', () => {
  const { slots } = planWeek({
    weekStart: MONDAY,
    topics: [topic('w2', { weekNumber: 2 })],
    exams: [],
    courseClassDays: { c1: [3] }, // çarşamba
    termStartByCourse: { c1: '2026-09-14' },
    dailyCapacityMinutes: 400,
  });
  assertEquals(slots.every((s) => s.dueDate >= WEDNESDAY), true);
});
