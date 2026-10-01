import { assertEquals } from 'jsr:@std/assert@1';
import {
  DEFAULT_DAILY_CAPACITY,
  learnDailyCapacity,
  localDateIn,
  MAX_CAPACITY,
  parseCapacityOverrides,
  planningBudget,
  resolveCapacity,
  workSamples,
} from './capacity.ts';
import { addDays } from './dates.ts';

/** Six weeks of days ending on the given Sunday. */
const daysEnding = (end: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => addDays(end, -(count - 1 - i)));

const weekdayOf = (date: string): number => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
};

// Çalışılmayan günler ortalamayı düşürür ama alt sınırın altına inmez.
const MIN_FLOOR = 30;

Deno.test('her gün kendi ortalamasını alır', () => {
  const days = daysEnding('2026-09-27', 28); // 4 hafta, pazartesi–pazar
  // Pazartesileri 30 dk, cumartesileri 180 dk çalışılmış.
  const samples = days.flatMap((date) => {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday === 1) return [{ date, minutes: 30 }];
    if (weekday === 6) return [{ date, minutes: 120 }, { date, minutes: 60 }];
    return [];
  });

  const { minutesByWeekday, learnedWeekdays } = learnDailyCapacity(samples, days);
  assertEquals(minutesByWeekday[1], 30); // pazartesi
  assertEquals(minutesByWeekday[6], 180); // cumartesi
  assertEquals(minutesByWeekday[3], MIN_FLOOR); // hiç çalışılmayan çarşamba tabana iner
  assertEquals(learnedWeekdays.includes(1) && learnedWeekdays.includes(6), true);
});

Deno.test('yeterli veri yoksa varsayılan korunur', () => {
  const days = daysEnding('2026-09-27', 3); // yalnızca 3 gün
  const { minutesByWeekday, learnedWeekdays } = learnDailyCapacity([{ date: days[0] as string, minutes: 90 }], days);
  assertEquals(learnedWeekdays, []);
  assertEquals(minutesByWeekday[1], DEFAULT_DAILY_CAPACITY);
});

Deno.test('aşırı uçlar makul aralığa çekilir', () => {
  const days = daysEnding('2026-09-27', 28);
  const mondays = days.filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1);
  const samples = mondays.map((date) => ({ date, minutes: 900 })); // günde 15 saat: açık kalmış sayaç
  const { minutesByWeekday } = learnDailyCapacity(samples, days);
  assertEquals(minutesByWeekday[1], MAX_CAPACITY); // üst sınır
});

Deno.test('pencere dışındaki kayıtlar sayılmaz', () => {
  const days = daysEnding('2026-09-27', 14);
  const { minutesByWeekday, learnedWeekdays } = learnDailyCapacity([{ date: '2020-01-06', minutes: 600 }], days);

  // Kayıt sayılsaydı pazartesi öğrenilmiş ve üst sınıra dayanmış olurdu.
  assertEquals(learnedWeekdays, []);
  assertEquals(minutesByWeekday[1], DEFAULT_DAILY_CAPACITY);
});

Deno.test('hiç iş bitmemişken varsayılan bütçe korunur, "günde 0 dakika" denmez', () => {
  const days = daysEnding('2026-09-20', 42);
  const learned = learnDailyCapacity([], days);

  assertEquals(learned.learnedWeekdays, []);
  for (let weekday = 1; weekday <= 7; weekday++) {
    assertEquals(learned.minutesByWeekday[weekday], DEFAULT_DAILY_CAPACITY);
  }
});

Deno.test('tek bir çalışılan gün bir günü öğrenilmiş saymaya yetmez', () => {
  const days = daysEnding('2026-09-20', 42);
  const learned = learnDailyCapacity([{ date: '2026-09-14', minutes: 120 }], days);

  assertEquals(learned.learnedWeekdays, []);
});

Deno.test('uygulamayı kullanmaya başlamadan önceki haftalar sıfır sayılmaz', () => {
  // Altı haftalık pencere, ama öğrenci yalnızca son iki haftadır kullanıyor:
  // her pazartesi 90 dakika. Eski hesap 4 boş haftayı da ortalamaya katıp 30 derdi.
  const days = daysEnding('2026-09-20', 42);
  const samples = ['2026-09-07', '2026-09-14'].map((date) => ({ date, minutes: 90 }));
  const learned = learnDailyCapacity(samples, days);

  assertEquals(learned.minutesByWeekday[1], 90);
  assertEquals(learned.learnedWeekdays.includes(1), true);
});

Deno.test('son haftalar eski haftalardan ağır basar', () => {
  const days = daysEnding('2026-09-20', 42);
  const mondays = days.filter((d) => weekdayOf(d) === 1); // 6 pazartesi
  // Dönem başında az, son haftalarda çok: aynı toplam, ters sıra.
  const rising = mondays.map((date, i) => ({ date, minutes: i < 3 ? 30 : 150 }));
  const falling = mondays.map((date, i) => ({ date, minutes: i < 3 ? 150 : 30 }));

  const recentHeavy = learnDailyCapacity(rising, days).minutesByWeekday[1] ?? 0;
  const oldHeavy = learnDailyCapacity(falling, days).minutesByWeekday[1] ?? 0;
  assertEquals(recentHeavy > 90 && oldHeavy < 90, true);
});

Deno.test('az görülen gün öğrencinin genel temposunu alır, uydurma 120 dakikayı değil', () => {
  // İki haftalık geçmiş; pazar yalnızca bir kez görülmüş.
  const days = daysEnding('2026-09-19', 13); // 7 Eyl Pzt – 19 Eyl Cmt
  const samples = days.map((date) => ({ date, minutes: 60 }));
  const learned = learnDailyCapacity(samples, days);

  assertEquals(learned.learnedWeekdays.includes(7), false);
  assertEquals(learned.minutesByWeekday[7], 60);
});

Deno.test('süre tutulan görev tahminiyle değil gerçek dakikasıyla sayılır', () => {
  const { samples, measuredDays } = workSamples(
    [
      { taskId: 'timed', parentTaskId: null, finishedOn: '2026-09-21', estimatedMinutes: 25 },
      { taskId: 'untimed', parentTaskId: null, finishedOn: '2026-09-21', estimatedMinutes: 40 },
    ],
    [{ taskId: 'timed', startedOn: '2026-09-21', minutes: 70 }],
  );

  assertEquals(measuredDays, 1);
  // Eski kural ölçülen günde tahminleri tamamen atıyordu: zamanlanmayan 40 dk kayboluyordu.
  assertEquals(samples, [
    { date: '2026-09-21', minutes: 70 },
    { date: '2026-09-21', minutes: 40 },
  ]);
});

Deno.test('alt adımlı ödev iki kez sayılmaz, tahmini olmayan iş sıfır sayılmaz', () => {
  const { samples } = workSamples(
    [
      { taskId: 'parent', parentTaskId: null, finishedOn: '2026-09-22', estimatedMinutes: 120 },
      { taskId: 'step-1', parentTaskId: 'parent', finishedOn: '2026-09-21', estimatedMinutes: 60 },
      { taskId: 'step-2', parentTaskId: 'parent', finishedOn: '2026-09-22', estimatedMinutes: 60 },
      { taskId: 'loose', parentTaskId: null, finishedOn: '2026-09-22', estimatedMinutes: null },
    ],
    [],
  );

  assertEquals(samples, [
    { date: '2026-09-21', minutes: 60 },
    { date: '2026-09-22', minutes: 60 },
    { date: '2026-09-22', minutes: 30 },
  ]);
});

Deno.test('öncelik: kapalı gün > öğrencinin sayısı > öğrenilen > genel tempo > varsayılan', () => {
  const today = '2026-09-28'; // pazartesi
  const finished = daysEnding('2026-09-27', 21).flatMap((date) =>
    weekdayOf(date) === 1 ? [{ taskId: date, parentTaskId: null, finishedOn: date, estimatedMinutes: 90 }] : [],
  );
  const profile = resolveCapacity({
    today,
    finished,
    timed: [],
    blockedWeekdays: [7],
    overrides: { 6: 180 },
  });

  const day = (weekday: number) => profile.days[weekday - 1];
  assertEquals([day(1)?.source, day(1)?.minutes], ['learned', 90]);
  assertEquals([day(6)?.source, day(6)?.minutes], ['override', 180]);
  assertEquals([day(7)?.source, day(7)?.minutes], ['blocked', 0]);
  // Salı 3 kez görüldü, hiç çalışılmadı: öğrenildi ama tabanda.
  assertEquals([day(2)?.source, day(2)?.minutes, day(2)?.observedMinutes], ['learned', 30, 0]);
  assertEquals(profile.historyStart, '2026-09-07');
  assertEquals(profile.activeDays, 3);

  const empty = resolveCapacity({ today, finished: [], timed: [] });
  assertEquals(empty.days.every((d) => d.source === 'default' && d.minutes === DEFAULT_DAILY_CAPACITY), true);
  assertEquals(empty.historyStart, null);
});

Deno.test('ders saati yalnızca tahmini bütçeden düşülür', () => {
  // Öğrenilmiş pazartesi zaten 6 saatlik dersin olduğu gerçek pazartesidir.
  assertEquals(planningBudget({ minutes: 60, source: 'learned' }, 360), 60);
  assertEquals(planningBudget({ minutes: 90, source: 'override' }, 360), 90);
  assertEquals(planningBudget({ minutes: 120, source: 'default' }, 120), 60);
  assertEquals(planningBudget({ minutes: 120, source: 'general' }, 360), 30);
  assertEquals(planningBudget({ minutes: 0, source: 'blocked' }, 0), 0);
});

Deno.test('profildeki elle girilmiş kapasite doğrulanarak okunur', () => {
  assertEquals(parseCapacityOverrides({ '1': 90, '6': 180, '9': 60, '2': 5, '3': 'x' }), { 1: 90, 6: 180 });
  assertEquals(parseCapacityOverrides(null), {});
});

Deno.test('zaman damgası öğrencinin kendi takvim gününe çevrilir', () => {
  // İstanbul'da gece 01:30 — UTC'de hâlâ önceki gün.
  assertEquals(localDateIn('2026-09-21T22:30:00Z', 'Europe/Istanbul'), '2026-09-22');
  assertEquals(localDateIn('2026-09-21T22:30:00Z', 'UTC'), '2026-09-21');
  assertEquals(localDateIn('2026-09-21T22:30:00Z', 'Bilinmeyen/Bölge'), '2026-09-21');
});
