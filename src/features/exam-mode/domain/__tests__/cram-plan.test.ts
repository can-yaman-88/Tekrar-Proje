import { buildCramPlan, type CramTopic } from '../cram-plan';
import { buildExamReviews } from '../exam-retro';

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

describe('buildExamReviews', () => {
  const base = [{ id: 'a', easeFactor: 2.5, intervalDays: 6, repetitions: 2 }];

  it('kötü geçen sınav konuyu başa döndürür', () => {
    const [review] = buildExamReviews(base, 1, [], '2026-09-27');
    expect(review?.repetitions).toBe(0);
    expect(review?.interval_days).toBe(1);
    expect(review?.next_review_on).toBe('2026-09-28');
  });

  it('iyi geçen sınav aralığı uzatır', () => {
    const [review] = buildExamReviews(base, 5, [], '2026-09-27');
    expect(review?.repetitions).toBe(3);
    expect(review?.interval_days).toBe(15);
  });

  it('işaretlenen konu sınav iyi geçse de tekrara döner', () => {
    const [review] = buildExamReviews(base, 5, ['a'], '2026-09-27');
    expect(review?.interval_days).toBe(1);
    expect(review?.ease_factor).toBeLessThan(2.5);
  });
});
