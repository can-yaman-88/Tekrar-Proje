import { assertEquals } from 'jsr:@std/assert@1';
import { bookedOn, planDeadlineWork, shareFor, type DayBudget, type DeadlineTask } from './workload.ts';

const TODAY = '2026-09-26'; // Cumartesi

const day = (date: string, capacity: number, committed = 0): DayBudget => ({
  date,
  capacityMinutes: capacity,
  committedMinutes: committed,
});

const work = (over: Partial<DeadlineTask> & { id: string; dueDate: string }): DeadlineTask => ({
  startsOn: null,
  remainingMinutes: 50,
  remainingCount: null,
  minutesPerUnit: null,
  ...over,
});

Deno.test('pay ham kapasiteden değil, o günün işi düşüldükten sonra kalan boşluktan çıkar', () => {
  // Kullanıcının örneği: kapasite 100, o günün concept+Feynman'ı 80 → boş 20.
  const plan = planDeadlineWork({
    today: TODAY,
    days: [day(TODAY, 100, 80), day('2026-09-27', 100, 0), day('2026-09-28', 100, 0)],
    tasks: [work({ id: 'odev', dueDate: '2026-09-28', remainingMinutes: 50 })],
  });

  const bugun = shareFor(plan, 'odev', TODAY);
  assertEquals((bugun?.minutes ?? 0) <= 20, true);
  // Sığmayan kısım kalan günlere taşar.
  assertEquals(bookedOn(plan, '2026-09-27') + bookedOn(plan, '2026-09-28') > 0, true);
  assertEquals(plan.shares.reduce((t, s) => t + s.minutes, 0), 50);
  assertEquals(plan.pressure, []);
});

Deno.test('dağıtım boşlukla orantılıdır: boş gün daha çok alır', () => {
  const plan = planDeadlineWork({
    today: TODAY,
    days: [day(TODAY, 120, 90), day('2026-09-27', 120, 0)],
    tasks: [work({ id: 'odev', dueDate: '2026-09-27', remainingMinutes: 60 })],
  });

  const bugun = shareFor(plan, 'odev', TODAY)?.minutes ?? 0;
  const yarin = shareFor(plan, 'odev', '2026-09-27')?.minutes ?? 0;
  assertEquals(bugun < yarin, true);
  assertEquals(bugun + yarin, 60);
});

Deno.test('çeyrek saatin altında kalan dilim başka güne aktarılır', () => {
  const plan = planDeadlineWork({
    today: TODAY,
    days: [day(TODAY, 100, 95), day('2026-09-27', 100, 0)],
    tasks: [work({ id: 'odev', dueDate: '2026-09-27', remainingMinutes: 60 })],
  });

  // Bugün yalnızca 5 dakika boş; 5 dakikalık dilim yerine tamamı yarına gider.
  assertEquals(shareFor(plan, 'odev', TODAY), null);
  assertEquals(shareFor(plan, 'odev', '2026-09-27')?.minutes, 60);
});

Deno.test('kapasite yetmezse açık miktar bildirilir, kalan yine de dağıtılır', () => {
  const plan = planDeadlineWork({
    today: TODAY,
    days: [day(TODAY, 60, 30), day('2026-09-27', 60, 30)],
    tasks: [work({ id: 'odev', dueDate: '2026-09-27', remainingMinutes: 120 })],
  });

  assertEquals(plan.pressure.length, 1);
  assertEquals(plan.pressure[0]?.freeMinutes, 60);
  assertEquals(plan.pressure[0]?.shortfallMinutes, 60);
  assertEquals(plan.shares.reduce((t, s) => t + s.minutes, 0), 60);
});

Deno.test('erken teslimli iş kapasiteyi önce ayırır', () => {
  const plan = planDeadlineWork({
    today: TODAY,
    days: [day(TODAY, 60, 0), day('2026-09-27', 60, 0)],
    tasks: [
      work({ id: 'gec', dueDate: '2026-09-27', remainingMinutes: 90 }),
      work({ id: 'erken', dueDate: TODAY, remainingMinutes: 60 }),
    ],
  });

  // Bugün tamamen erken teslimli işe gider; geç olanın bugünden payı kalmaz.
  assertEquals(shareFor(plan, 'erken', TODAY)?.minutes, 60);
  assertEquals(shareFor(plan, 'gec', TODAY), null);
  assertEquals(shareFor(plan, 'gec', '2026-09-27')?.minutes, 60);
  assertEquals(plan.pressure.map((p) => p.taskId), ['gec']);
});

Deno.test('soru sayısı olan işte pay soruya çevrilir', () => {
  const plan = planDeadlineWork({
    today: TODAY,
    days: [day(TODAY, 100, 0), day('2026-09-27', 100, 0)],
    tasks: [
      work({ id: 'odev', dueDate: '2026-09-27', remainingMinutes: 60, remainingCount: 12, minutesPerUnit: 5 }),
    ],
  });

  assertEquals(shareFor(plan, 'odev', TODAY)?.count, 6);
  assertEquals(shareFor(plan, 'odev', '2026-09-27')?.count, 6);
});

Deno.test('pencere teslimden yedi gün öncesinde açılır', () => {
  const days: DayBudget[] = [];
  for (let i = 0; i < 12; i++) days.push(day(`2026-09-${String(26 + i).padStart(2, '0')}`, 100, 0));

  const plan = planDeadlineWork({
    today: TODAY,
    days,
    tasks: [work({ id: 'uzak', dueDate: '2026-10-06', remainingMinutes: 60 })],
  });

  // 6 Ekim teslim → pencere 29 Eylül'de açılır, bugüne pay düşmez.
  assertEquals(shareFor(plan, 'uzak', TODAY), null);
  assertEquals(plan.shares.every((s) => s.date >= '2026-09-29'), true);
});

Deno.test('öğrencinin seçtiği başlama günü pencereyi öne çeker', () => {
  const days: DayBudget[] = [];
  for (let i = 0; i < 12; i++) days.push(day(`2026-09-${String(26 + i).padStart(2, '0')}`, 100, 0));

  const plan = planDeadlineWork({
    today: TODAY,
    days,
    tasks: [work({ id: 'uzak', dueDate: '2026-10-06', remainingMinutes: 60, startsOn: TODAY })],
  });

  assertEquals(plan.shares.some((s) => s.date === TODAY), true);
});

Deno.test('biten iş pay almaz', () => {
  const plan = planDeadlineWork({
    today: TODAY,
    days: [day(TODAY, 100, 0)],
    tasks: [work({ id: 'bitti', dueDate: TODAY, remainingMinutes: 0 })],
  });

  assertEquals(plan.shares, []);
  assertEquals(plan.pressure, []);
});

// ---------------------------------------------------------------------------
// The student's own decisions about which day gets what.
// ---------------------------------------------------------------------------
Deno.test('elle girilen gün aynen uygulanır, kalan iş diğer günlere dağılır', () => {
  const plan = planDeadlineWork({
    today: TODAY,
    days: [day(TODAY, 100, 0), day('2026-09-27', 100, 0), day('2026-09-28', 100, 0)],
    tasks: [
      work({
        id: 'odev',
        dueDate: '2026-09-28',
        remainingMinutes: 120,
        fixedByDate: { '2026-09-27': 60 },
      }),
    ],
  });

  assertEquals(shareFor(plan, 'odev', '2026-09-27')?.minutes, 60);
  assertEquals(shareFor(plan, 'odev', '2026-09-27')?.isManual, true);
  // Kalan 60 dakika elle dokunulmamış günlere bölünür.
  assertEquals(bookedOn(plan, TODAY) + bookedOn(plan, '2026-09-28'), 60);
});

Deno.test('sıfır yazılan gün kapalıdır, o güne pay düşmez', () => {
  const plan = planDeadlineWork({
    today: TODAY,
    days: [day(TODAY, 100, 0), day('2026-09-27', 100, 0)],
    tasks: [
      work({ id: 'odev', dueDate: '2026-09-27', remainingMinutes: 60, fixedByDate: { [TODAY]: 0 } }),
    ],
  });

  assertEquals(shareFor(plan, 'odev', TODAY), null);
  assertEquals(shareFor(plan, 'odev', '2026-09-27')?.minutes, 60);
});

Deno.test('elle girilen toplam işi aşarsa fazlası kırpılır', () => {
  const plan = planDeadlineWork({
    today: TODAY,
    days: [day(TODAY, 300, 0), day('2026-09-27', 300, 0)],
    tasks: [
      work({
        id: 'odev',
        dueDate: '2026-09-27',
        remainingMinutes: 60,
        fixedByDate: { [TODAY]: 50, '2026-09-27': 90 },
      }),
    ],
  });

  assertEquals(plan.shares.reduce((total, share) => total + share.minutes, 0), 60);
  assertEquals(shareFor(plan, 'odev', TODAY)?.minutes, 50);
  assertEquals(shareFor(plan, 'odev', '2026-09-27')?.minutes, 10);
  assertEquals(plan.pressure, []);
});

Deno.test('elle girilen gün kapasiteyi aşsa bile öğrencinin dediği olur', () => {
  const plan = planDeadlineWork({
    today: TODAY,
    days: [day(TODAY, 60, 50)], // yalnızca 10 dakika boş
    tasks: [work({ id: 'odev', dueDate: TODAY, remainingMinutes: 45, fixedByDate: { [TODAY]: 45 } })],
  });

  assertEquals(shareFor(plan, 'odev', TODAY)?.minutes, 45);
});
