import { assertEquals } from 'jsr:@std/assert@1';
import { buildCapacitySamples, DEFAULT_DAILY_CAPACITY, learnDailyCapacity } from './capacity.ts';
import { addDays } from './dates.ts';

/** Six weeks of days ending on the given Sunday. */
const daysEnding = (end: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => addDays(end, -(count - 1 - i)));

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

// Çalışılmayan günler ortalamayı düşürür ama alt sınırın altına inmez.
const MIN_FLOOR = 30;

Deno.test('yeterli veri yoksa varsayılan korunur', () => {
  const days = daysEnding('2026-09-27', 3); // yalnızca 3 gün
  const { minutesByWeekday, learnedWeekdays } = learnDailyCapacity([{ date: days[0] as string, minutes: 90 }], days);
  assertEquals(learnedWeekdays, []);
  assertEquals(minutesByWeekday[1], DEFAULT_DAILY_CAPACITY);
});

Deno.test('aşırı uçlar makul aralığa çekilir', () => {
  const days = daysEnding('2026-09-27', 28);
  const mondays = days.filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1);
  const samples = mondays.map((date) => ({ date, minutes: 600 })); // günde 10 saat
  const { minutesByWeekday } = learnDailyCapacity(samples, days);
  assertEquals(minutesByWeekday[1], 300); // üst sınır
});

Deno.test('pencere dışındaki kayıtlar sayılmaz', () => {
  const days = daysEnding('2026-09-27', 14);
  const { minutesByWeekday, learnedWeekdays } = learnDailyCapacity([{ date: '2020-01-06', minutes: 600 }], days);

  // Kayıt sayılsaydı pazartesi öğrenilmiş ve üst sınıra dayanmış olurdu.
  assertEquals(learnedWeekdays, []);
  assertEquals(minutesByWeekday[1], DEFAULT_DAILY_CAPACITY);
});

Deno.test('measured minutes replace the estimates of the days they cover', () => {
  const { samples, measuredDays } = buildCapacitySamples(
    [{ date: '2026-09-21', minutes: 95 }],
    [
      { date: '2026-09-21', minutes: 25 },
      { date: '2026-09-22', minutes: 40 },
    ],
  );

  assertEquals(measuredDays, 1);
  assertEquals(samples, [
    { date: '2026-09-21', minutes: 95 },
    { date: '2026-09-22', minutes: 40 },
  ]);
});

Deno.test('with no stopwatch history the estimates are used untouched', () => {
  const estimates = [{ date: '2026-09-22', minutes: 40 }];
  const { samples, measuredDays } = buildCapacitySamples([], estimates);

  assertEquals(measuredDays, 0);
  assertEquals(samples, estimates);
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

Deno.test('çalışma varsa boş günler ortalamayı düşürür', () => {
  const days = daysEnding('2026-09-20', 42);
  // Altı pazartesinin ikisinde 120 dakika, dördünde hiç: ortalama 40 dakika.
  const samples = [
    { date: '2026-08-17', minutes: 120 },
    { date: '2026-08-24', minutes: 120 },
  ];
  const learned = learnDailyCapacity(samples, days);

  assertEquals(learned.minutesByWeekday[1], 40); // pazartesi
  assertEquals(learned.minutesByWeekday[2], 30); // hiç çalışılmayan salı tabana iner
  assertEquals(learned.learnedWeekdays.includes(1), true);
});
