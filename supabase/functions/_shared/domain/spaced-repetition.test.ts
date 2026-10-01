import { assertEquals } from 'jsr:@std/assert@1';
import { reviewSm2, scheduleReview } from './spaced-repetition.ts';

const fresh = { easeFactor: 2.5, intervalDays: 0, repetitions: 0 };
const learning = { easeFactor: 2.5, intervalDays: 6, repetitions: 2 };

Deno.test('ilk kez çalışılan konu ertesi güne yazılır', () => {
  const decision = scheduleReview(fresh, 4, { reviewedOn: '2026-10-01', dueOn: null, lastReviewedOn: null });
  assertEquals(decision, {
    counted: true,
    state: { easeFactor: 2.5, intervalDays: 1, repetitions: 1 },
    nextReviewOn: '2026-10-02',
    early: false,
  });
});

Deno.test('aynı gün ikinci geçiş sayılmaz', () => {
  const decision = scheduleReview(learning, 5, { reviewedOn: '2026-10-01', dueOn: '2026-10-01', lastReviewedOn: '2026-10-01' });
  assertEquals(decision, { counted: false });
});

Deno.test('aynı gün gelen başarısızlık yine de sayılır ve aralığı sıfırlar', () => {
  const decision = scheduleReview(learning, 1, { reviewedOn: '2026-10-01', dueOn: '2026-10-07', lastReviewedOn: '2026-10-01' });
  assertEquals(decision.counted && [decision.state.repetitions, decision.state.intervalDays, decision.nextReviewOn], [
    0,
    1,
    '2026-10-02',
  ]);
});

Deno.test('son sayılan tekrardan eski bir rapor takvimi değiştirmez', () => {
  const decision = scheduleReview(learning, 1, { reviewedOn: '2026-09-28', dueOn: '2026-10-07', lastReviewedOn: '2026-10-01' });
  assertEquals(decision, { counted: false });
});

Deno.test('vaktinden önce yapılan tekrar aralığı uzatmaz, saati yeniden başlatır', () => {
  // Son tekrar 1 Ekim, aralık 6 gün → 7 Ekim'de vadesi geliyor. 3 Ekim'de çalışıldı.
  const decision = scheduleReview(learning, 5, { reviewedOn: '2026-10-03', dueOn: '2026-10-07', lastReviewedOn: '2026-10-01' });
  assertEquals(decision, {
    counted: true,
    state: learning,
    nextReviewOn: '2026-10-09',
    early: true,
  });
});

Deno.test('vadesi gelen tekrar bir SM-2 adımı ilerler', () => {
  const decision = scheduleReview(learning, 4, { reviewedOn: '2026-10-08', dueOn: '2026-10-07', lastReviewedOn: '2026-10-01' });
  const expected = reviewSm2(learning, 4);
  assertEquals(decision, { counted: true, state: expected, nextReviewOn: '2026-10-23', early: false });
});
