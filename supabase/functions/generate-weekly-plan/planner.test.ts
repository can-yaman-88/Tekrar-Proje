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
  position: 0,
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
  // Konsept ve Feynman aynı oturum: ikisi de çarşamba. Yer olduğu için sınav da
  // aynı gün — Feynman'dan önceye düşmedikçe aynı gün de olabilir.
  assertEquals(slots.map((s) => s.step), ['concept_note', 'feynman', 'quiz']);
  assertEquals(slots.map((s) => s.dueDate), [WEDNESDAY, WEDNESDAY, WEDNESDAY]);
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
  assertEquals(minutesOn(FRIDAY) <= 60, true);
  // Cumartesi (26 Eylül) boş gün: en çok iş oraya düşer.
  assertEquals(minutesOn('2026-09-26') > 60, true);
});

Deno.test('ödev haftanın kapasitesinden önce pay alır', () => {
  const topic = (id: string, courseId: string): PlanTopic => ({
    id,
    title: `Konu ${id}`,
    courseId,
    courseLabel: 'ME201',
    weekNumber: 1,
    position: 0,
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
    position: 0,
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

Deno.test('konsept ve Feynman aynı güne; yer varsa sınav da aynı güne düşer', () => {
  const { slots } = planWeek({
    weekStart: MONDAY,
    topics: [topic('a')],
    exams: [],
    dailyCapacityMinutes: 400,
  });

  const dayOf = (step: string) => slots.find((s) => s.step === step)?.dueDate;
  assertEquals(dayOf('concept_note'), dayOf('feynman'));
  assertEquals(dayOf('quiz'), dayOf('feynman'));
});

Deno.test('sınav Feynman gününe sığmazsa sonraki bir güne gider, asla önceye değil', () => {
  const { slots } = planWeek({
    weekStart: MONDAY,
    topics: [topic('a')],
    exams: [],
    // Konsept + Feynman 55 dakika: 60 dakikalık günde 25 dakikalık sınava yer kalmaz.
    dailyCapacityMinutes: 60,
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

// ---------------------------------------------------------------------------
// Öğrenme görevi: konsept + Feynman tek görev
// ---------------------------------------------------------------------------
Deno.test('konsept ve Feynman aynı öğrenme görevinin adımları olur', () => {
  const { slots } = planWeek({ weekStart: MONDAY, topics: [topic('a')], exams: [] });

  const keyOf = (step: string) => slots.find((s) => s.step === step)?.learningGroupKey ?? null;
  assertEquals(keyOf('concept_note'), keyOf('feynman'));
  assertEquals(keyOf('concept_note') === null, false);
  // Sınav kendi başına bir görev: öğrenme görevine girmez.
  assertEquals(keyOf('quiz'), null);
});

Deno.test('çift ayrı günlere düşse bile tek öğrenme görevi kalır', () => {
  const { slots, notes } = planWeek({
    weekStart: MONDAY,
    topics: [topic('a')],
    exams: [],
    // İkisini bir arada tutamayacak kadar dar günler.
    capacityByWeekday: { 1: 30, 2: 30, 3: 30, 4: 30, 5: 30, 6: 30, 7: 30 },
  });

  const concept = slots.find((s) => s.step === 'concept_note');
  const feynman = slots.find((s) => s.step === 'feynman');
  assertEquals(concept?.learningGroupKey === null, false);
  assertEquals(concept?.learningGroupKey, feynman?.learningGroupKey);
  assertEquals(concept?.dueDate === feynman?.dueDate, false);
  assertEquals(notes.some((note) => note.includes('aynı güne sığmadı')), true);
});

Deno.test('tekrar turunda öğrenme görevi açılmaz', () => {
  const { slots } = planWeek({
    weekStart: MONDAY,
    topics: [topic('a', { completedSteps: ['concept_note', 'feynman', 'quiz'], nextReviewOn: MONDAY })],
    exams: [],
  });

  assertEquals(slots.map((s) => s.step), ['feynman', 'quiz']);
  assertEquals(slots.every((s) => s.learningGroupKey === null), true);
});

Deno.test('eşit puanda konu seçimi izlence sırasıyla yapılır, alfabeyle değil', () => {
  const { slots } = planWeek({
    weekStart: MONDAY,
    topics: [
      // Alfabetik sırada önde, izlencede geride.
      topic('capacitance', { title: 'Capacitance and dielectrics', weekNumber: 6, repetitions: 0, lastReviewedAt: null }),
      topic('charge', { title: 'Electric charge', weekNumber: 2, repetitions: 0, lastReviewedAt: null }),
      topic('gauss', { title: 'Gauss law', weekNumber: 2, position: 1, repetitions: 0, lastReviewedAt: null }),
    ],
    exams: [],
    // Tam döngünün sığdığı tek gün pazartesi: kim alır? Diğer günlerde tek adımlık yer var.
    capacityByWeekday: { 1: 80, 2: 30, 3: 30, 4: 30, 5: 30, 6: 30, 7: 30 },
  });

  // İzlencede ilk olan (2. hafta, ilk konu) pazartesiyi alır; alfabede önde
  // olan 6. hafta konusu en sona, artan yere kalır.
  assertEquals([...new Set(slots.filter((s) => s.dueDate === MONDAY).map((s) => s.topicId))], ['charge']);
  const firstDay = (id: string) => slots.filter((s) => s.topicId === id).map((s) => s.dueDate).sort()[0] ?? '';
  assertEquals(firstDay('charge') < firstDay('gauss') && firstDay('gauss') < firstDay('capacitance'), true);
});

Deno.test('ders dolu gün bile bir konsept + Feynman oturumu kadar yer tutar', () => {
  const { slots } = planWeek({
    weekStart: MONDAY,
    topics: [topic('a', { repetitions: 0, lastReviewedAt: null })],
    exams: [],
    courseClassDays: { c1: [3] },
    // Çarşamba 440 dakika ders: bütçenin yarısından fazlası gider.
    classLoad: { 3: 440 },
    capacityByWeekday: { 1: 150, 2: 150, 3: 150, 4: 150, 5: 150, 6: 150, 7: 150 },
  });

  const dayOf = (step: string) => slots.find((s) => s.step === step)?.dueDate;
  // 30 dakikalık tabanla oturum çarşambaya sığmazdı; 60 ile ikisi birlikte orada.
  assertEquals([dayOf('concept_note'), dayOf('feynman')], [WEDNESDAY, WEDNESDAY]);
});

Deno.test('taban, günün kendi bütçesini aşmaz: kapalı gün kapalı kalır', () => {
  const { slots } = planWeek({
    weekStart: MONDAY,
    topics: [topic('a', { repetitions: 0, lastReviewedAt: null })],
    exams: [],
    classLoad: { 1: 300 },
    // Pazartesi öğrencinin kapattığı gün: bütçesi sıfır.
    capacityByWeekday: { 1: 0, 2: 150, 3: 150, 4: 150, 5: 150, 6: 150, 7: 150 },
  });

  assertEquals(slots.some((s) => s.dueDate === MONDAY), false);
});

Deno.test('hafta ortasında yapılan plan geçmiş günlere iş koymaz', () => {
  const { slots } = planWeek({
    weekStart: MONDAY,
    today: WEDNESDAY,
    topics: [topic('a', { repetitions: 0, lastReviewedAt: null }), topic('b', { repetitions: 0, lastReviewedAt: null })],
    exams: [],
    dailyCapacityMinutes: 400,
  });

  assertEquals(slots.length > 0, true);
  assertEquals(slots.every((s) => s.dueDate >= WEDNESDAY), true);
});

Deno.test('haftanın günü kalmadıysa plan boş döner ve nedenini söyler', () => {
  const { slots, notes } = planWeek({
    weekStart: MONDAY,
    today: '2026-09-28',
    topics: [topic('a', { repetitions: 0, lastReviewedAt: null })],
    exams: [],
  });

  assertEquals([slots, notes], [[], ['Bu haftanın planlanacak günü kalmadı.']]);
});
