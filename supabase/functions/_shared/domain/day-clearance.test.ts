import { assertEquals } from 'jsr:@std/assert@1';
import { planDayClearance, type ClearedTask } from './day-clearance.ts';
import type { DayBudget } from './workload.ts';

const day = (date: string, capacity: number, committed = 0): DayBudget => ({
  date,
  capacityMinutes: capacity,
  committedMinutes: committed,
});

const task = (id: string, dueDate: string, minutes = 30, hasDeadline = false): ClearedTask => ({
  id,
  dueDate,
  estimatedMinutes: minutes,
  hasDeadline,
});

Deno.test('kapanan günün işi kalan günlere dağılır', () => {
  const plan = planDayClearance({
    days: [day('2026-09-28', 60), day('2026-09-29', 60)],
    tasks: [task('a', '2026-10-04'), task('b', '2026-10-04'), task('c', '2026-10-04')],
  });

  assertEquals(plan.placements, [
    { taskId: 'a', date: '2026-09-28' },
    { taskId: 'b', date: '2026-09-28' },
    { taskId: 'c', date: '2026-09-29' },
  ]);
  assertEquals(plan.overflowMinutes, 0);
});

Deno.test('dolu gün atlanır, iş bir sonraki boş güne gider', () => {
  const plan = planDayClearance({
    days: [day('2026-09-28', 60, 60), day('2026-09-29', 60)],
    tasks: [task('a', '2026-10-04')],
  });

  assertEquals(plan.placements, [{ taskId: 'a', date: '2026-09-29' }]);
});

Deno.test('teslim tarihli iş öne çekilir, sonraya atılmaz', () => {
  const plan = planDayClearance({
    days: [day('2026-09-28', 60), day('2026-09-29', 60), day('2026-10-01', 60)],
    // Ödev pazar (30 Eylül) teslim; pazar kapandı.
    tasks: [task('odev', '2026-09-30', 45, true)],
  });

  assertEquals(plan.placements, [{ taskId: 'odev', date: '2026-09-28' }]);
  assertEquals(plan.lateTaskIds, []);
});

Deno.test('teslim öncesi yer kalmadıysa iş geç kalır ve bildirilir', () => {
  const plan = planDayClearance({
    days: [day('2026-09-28', 60, 60), day('2026-10-01', 60)],
    tasks: [task('odev', '2026-09-30', 45, true)],
  });

  assertEquals(plan.placements, [{ taskId: 'odev', date: '2026-10-01' }]);
  assertEquals(plan.lateTaskIds, ['odev']);
});

Deno.test('teslim tarihli iş, serbest işten önce yer seçer', () => {
  const plan = planDayClearance({
    days: [day('2026-09-28', 60), day('2026-09-29', 60)],
    tasks: [task('serbest', '2026-10-04', 45), task('odev', '2026-09-30', 45, true)],
  });

  assertEquals(plan.placements, [
    { taskId: 'odev', date: '2026-09-28' },
    { taskId: 'serbest', date: '2026-09-29' },
  ]);
});

Deno.test('hiçbir yere sığmayan iş yine de kapanan günden çıkar', () => {
  const plan = planDayClearance({
    days: [day('2026-09-28', 60, 50), day('2026-09-29', 60, 20)],
    tasks: [task('uzun', '2026-10-04', 120)],
  });

  // En çok yeri olan gün: 29 Eylül (40 dk boş). İş orada, 80 dk taşarak duruyor.
  assertEquals(plan.placements, [{ taskId: 'uzun', date: '2026-09-29' }]);
  assertEquals(plan.overflowMinutes, 80);
});

Deno.test('tahmini olmayan iş 30 dakika sayılır', () => {
  const plan = planDayClearance({
    days: [day('2026-09-28', 30)],
    tasks: [task('a', '2026-10-04', 0)],
  });

  assertEquals(plan.placements, [{ taskId: 'a', date: '2026-09-28' }]);
  assertEquals(plan.overflowMinutes, 0);
});

Deno.test('gidecek gün yoksa hiçbir şey taşınmaz', () => {
  const plan = planDayClearance({ days: [], tasks: [task('a', '2026-10-04')] });
  assertEquals(plan, { placements: [], overflowMinutes: 0, lateTaskIds: [] });
});
