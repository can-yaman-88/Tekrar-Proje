import { allocateProblems, buildCramPlan, interleave, type CramTopic } from '../cram-plan';

const topic = (over: Partial<CramTopic> & { id: string; title: string }): CramTopic => ({
  weekNumber: 1,
  position: 0,
  easeFactor: 2.5,
  repetitions: 1,
  nextReviewOn: null,
  completedSteps: [],
  recentFailures: 0,
  ...over,
});

describe('buildCramPlan', () => {
  it('eşit riskte izlence sırasına uyar, alfabeye değil', () => {
    const plan = buildCramPlan({
      today: '2026-09-25',
      examDate: '2026-09-30',
      topics: [
        topic({ id: 'late', title: 'Akı', weekNumber: 6 }),
        topic({ id: 'early', title: 'Yük', weekNumber: 2 }),
      ],
    });

    expect(plan.readiness.map((row) => row.id)).toEqual(['early', 'late']);
  });

  it('sıralamayı en zayıf konudan başlatır', () => {
    const plan = buildCramPlan({
      today: '2026-09-25',
      examDate: '2026-09-30',
      topics: [
        topic({ id: 'solid', title: 'Sağlam', completedSteps: ['concept_note', 'quiz', 'feynman'], easeFactor: 2.8 }),
        topic({ id: 'weak', title: 'Zayıf', easeFactor: 1.8, recentFailures: 2 }),
      ],
    });

    expect(plan.readiness.map((row) => row.id)).toEqual(['weak', 'solid']);
    expect(plan.readiness[0]?.mastery).toBe('weak');
    expect(plan.readiness[1]?.mastery).toBe('solid');
  });

  it('yarım kalan döngüyü sırasıyla tamamlatır', () => {
    const plan = buildCramPlan({
      today: '2026-09-25',
      examDate: '2026-09-30',
      topics: [topic({ id: 't', title: 'Entropi', completedSteps: ['concept_note'] })],
    });

    const steps = plan.days.flatMap((day) => day.items.map((item) => item.step));
    expect(steps).toEqual(['feynman', 'quiz']);
    // Sıra bozulmamalı: Feynman sınavdan önce ya da aynı gün.
    const dates = plan.days.flatMap((day) => day.items.map((item) => item.dueDate));
    expect((dates[0] ?? '') <= (dates[1] ?? '')).toBe(true);
  });

  it('döngüsü biten sağlam konuya yalnızca hatırlama turu koyar', () => {
    const plan = buildCramPlan({
      today: '2026-09-25',
      examDate: '2026-09-29',
      topics: [
        topic({
          id: 't',
          title: 'Kafesler',
          completedSteps: ['concept_note', 'quiz', 'feynman'],
          easeFactor: 2.9,
          repetitions: 3,
        }),
      ],
    });

    expect(plan.days.flatMap((day) => day.items.map((item) => item.step))).toEqual(['feynman']);
  });

  it('sınav günü çalışma günü sayılmaz', () => {
    const plan = buildCramPlan({
      today: '2026-09-25',
      examDate: '2026-09-27',
      topics: [topic({ id: 't', title: 'Akışkanlar' })],
    });

    expect(plan.days.every((day) => day.date < '2026-09-27')).toBe(true);
  });

  it('kalan güne sığmayan adımları bırakır ve bunu söyler', () => {
    const many = Array.from({ length: 12 }, (_, i) => topic({ id: `t${i}`, title: `Konu ${i}` }));
    const plan = buildCramPlan({
      today: '2026-09-25',
      examDate: '2026-09-27',
      topics: many,
      capacityByWeekday: { 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 60, 7: 60 },
    });

    expect(plan.droppedSteps).toBeGreaterThan(0);
    expect(plan.notes.join(' ')).toContain('sığmadı');
  });
});

const DONE = ['concept_note', 'quiz', 'feynman'] as const;

describe('karışık tekrar seti', () => {
  const learned = (id: string, over: Partial<CramTopic> = {}) =>
    topic({ id, title: id.toUpperCase(), completedSteps: [...DONE], ...over });

  it('sınava 4 ve 2 gün kala birer set koyar, arifeye koymaz', () => {
    const plan = buildCramPlan({
      today: '2026-09-24',
      examDate: '2026-09-30',
      topics: [learned('a', { easeFactor: 1.6 }), learned('b'), learned('c', { easeFactor: 2.9 })],
    });

    expect(plan.mixedSets.map((set) => set.dueDate)).toEqual(['2026-09-26', '2026-09-28']);
    for (const set of plan.mixedSets) {
      expect(set.problems).toBe(12);
      expect(set.sequence).toHaveLength(12);
      expect(set.parts.reduce((sum, part) => sum + part.problems, 0)).toBe(12);
      // Hiçbir konu art arda gelmez.
      expect(set.sequence.some((letter, i) => i > 0 && letter === set.sequence[i - 1])).toBe(false);
      // Her parçanın yerleri sıradaki harfleriyle aynı.
      for (const part of set.parts) {
        expect(part.positions.every((place) => set.sequence[place - 1] === part.letter)).toBe(true);
        expect(part.positions).toHaveLength(part.problems);
      }
      expect(set.estimatedMinutes).toBe(48);
    }
    // A en zayıf konu ve en çok soruyu o alır.
    const first = plan.mixedSets[0];
    expect(first?.parts[0]?.topicId).toBe('a');
    expect(Math.max(...(first?.parts.map((part) => part.problems) ?? []))).toBe(first?.parts[0]?.problems);
    // Setler günün dakikasına sayılır.
    const day = plan.days.find((d) => d.date === '2026-09-26');
    expect(day?.minutes).toBe(
      (day?.items.reduce((sum, item) => sum + item.estimatedMinutes, 0) ?? 0) + (first?.estimatedMinutes ?? 0),
    );
  });

  it('döngüsü o güne kadar bitmeyen konuyu sete almaz', () => {
    const plan = buildCramPlan({
      today: '2026-09-24',
      examDate: '2026-09-30',
      topics: [learned('a'), learned('b'), topic({ id: 'new', title: 'Yeni', completedSteps: [] })],
    });

    const loopDays = plan.days
      .filter((day) => day.items.some((item) => item.topicId === 'new'))
      .map((day) => day.date);
    const finished = loopDays[loopDays.length - 1] ?? '';
    for (const set of plan.mixedSets) {
      const hasNew = set.parts.some((part) => part.topicId === 'new');
      // Yeni konu ancak döngüsünün bittiği günden sonraki bir sette yer alabilir.
      if (hasNew) expect(set.dueDate > finished).toBe(true);
    }
    expect(plan.mixedSets.length).toBeGreaterThan(0);
  });

  it('kapalı güne ne adım ne set koyar; seti yan güne kaydırır', () => {
    // 26 Eylül cumartesi: kapalı.
    const plan = buildCramPlan({
      today: '2026-09-24',
      examDate: '2026-09-30',
      topics: [learned('a'), learned('b'), learned('c')],
      capacityByWeekday: { 1: 150, 2: 150, 3: 150, 4: 150, 5: 150, 6: 0, 7: 150 },
    });

    expect(plan.days.some((day) => day.date === '2026-09-26')).toBe(false);
    expect(plan.mixedSets.map((set) => set.dueDate)).toEqual(['2026-09-25', '2026-09-28']);
  });

  it('kısa bir sprintte en fazla bir set olur', () => {
    const plan = buildCramPlan({
      today: '2026-09-27',
      examDate: '2026-09-30',
      topics: [learned('a'), learned('b')],
    });

    expect(plan.mixedSets.map((set) => set.dueDate)).toEqual(['2026-09-28']);
  });

  it('tek hazır konu varsa set yerine nedenini söyler', () => {
    // Üç gün kaldı ve günler dar: yeni konunun döngüsü ancak arifede biter.
    const plan = buildCramPlan({
      today: '2026-09-27',
      examDate: '2026-09-30',
      topics: [learned('a'), topic({ id: 'x', title: 'X', completedSteps: [] })],
      capacityByWeekday: { 1: 30, 2: 30, 3: 30, 4: 30, 5: 30, 6: 30, 7: 30 },
    });

    expect(plan.mixedSets).toEqual([]);
    expect(plan.notes.some((note) => note.includes('Karışık tekrar seti'))).toBe(true);
  });

  it('dar günde seti küçültür ama 6 sorunun altına inmez', () => {
    const plan = buildCramPlan({
      today: '2026-09-24',
      examDate: '2026-09-30',
      topics: [learned('a'), learned('b'), learned('c')],
      // Hatırlama turları günde 25-55 dk alır; sete kalan yer azdır.
      capacityByWeekday: { 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 60, 7: 60 },
    });

    for (const set of plan.mixedSets) {
      expect(set.problems).toBeGreaterThanOrEqual(6);
      expect(set.estimatedMinutes).toBeLessThanOrEqual(60);
      expect(set.parts.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('soru dağılımı ve sıra', () => {
  it('her konuya en az iki soru verir, kalanı zayıflığa göre böler', () => {
    expect(allocateProblems([3, 2, 1], 12)).toEqual([5, 4, 3]);
    expect(allocateProblems([1, 1], 7)).toEqual([4, 3]);
    expect(allocateProblems([3, 3, 3, 3], 8)).toEqual([2, 2, 2, 2]);
  });

  it('aynı konuyu art arda vermez ve hep aynı sırayı üretir', () => {
    const order = interleave([5, 4, 3]);
    expect(order).toHaveLength(12);
    expect(order.some((topicIndex, i) => i > 0 && topicIndex === order[i - 1])).toBe(false);
    expect([0, 1, 2].map((t) => order.filter((x) => x === t).length)).toEqual([5, 4, 3]);
    expect(interleave([5, 4, 3])).toEqual(order);
  });
});
