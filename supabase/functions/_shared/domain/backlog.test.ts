import { assertEquals } from 'jsr:@std/assert@1';
import { rescheduleBacklog, type BacklogTask } from './backlog.ts';
import type { DayBudget } from './workload.ts';

const day = (date: string, capacity: number, committed = 0): DayBudget => ({
  date,
  capacityMinutes: capacity,
  committedMinutes: committed,
});

const task = (id: string, dueDate: string, minutes = 30): BacklogTask => ({
  id,
  dueDate,
  estimatedMinutes: minutes,
});

Deno.test('en eski borç en erken güne gider', () => {
  const plan = rescheduleBacklog({
    days: [day('2026-09-28', 60), day('2026-09-29', 60)],
    tasks: [task('yeni', '2026-09-25'), task('eski', '2026-09-20')],
  });

  assertEquals(plan.placements, [
    { taskId: 'eski', date: '2026-09-28' },
    { taskId: 'yeni', date: '2026-09-28' },
  ]);
});

Deno.test('gün dolunca bir sonraki güne taşar', () => {
  const plan = rescheduleBacklog({
    days: [day('2026-09-28', 60, 40), day('2026-09-29', 60)],
    tasks: [task('a', '2026-09-20', 30), task('b', '2026-09-21', 30)],
  });

  assertEquals(plan.placements[0]?.date, '2026-09-29'); // bugün yalnızca 20 dk boş
  assertEquals(plan.placements[1]?.date, '2026-09-29');
  assertEquals(plan.unplacedMinutes, 0);
});

Deno.test('hiçbir güne sığmayan iş bildirilir, zorla yerleştirilmez', () => {
  const plan = rescheduleBacklog({
    days: [day('2026-09-28', 30)],
    tasks: [task('a', '2026-09-20', 30), task('b', '2026-09-21', 45)],
  });

  assertEquals(plan.placements, [{ taskId: 'a', date: '2026-09-28' }]);
  assertEquals(plan.unplacedMinutes, 45);
});

Deno.test('tahmini olmayan görev de bir yer kaplar', () => {
  const plan = rescheduleBacklog({
    days: [day('2026-09-28', 30)],
    tasks: [task('a', '2026-09-20', 0)],
  });

  assertEquals(plan.placements, [{ taskId: 'a', date: '2026-09-28' }]);
});
