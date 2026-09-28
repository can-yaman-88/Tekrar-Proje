import { isWeekday, sessionMinutes, toShortTime, WEEKDAY_LABEL, WEEKDAYS } from '../class-session';

describe('ders programı alanı', () => {
  it('saatleri kısaltır', () => {
    expect(toShortTime('09:00:00')).toBe('09:00');
    expect(toShortTime('13:45')).toBe('13:45');
  });

  it('ders süresini dakika olarak verir', () => {
    expect(sessionMinutes({ startTime: '09:00', endTime: '10:50' })).toBe(110);
    expect(sessionMinutes({ startTime: '09:00:00', endTime: '12:00:00' })).toBe(180);
    // Ters aralık negatif dönmez.
    expect(sessionMinutes({ startTime: '12:00', endTime: '09:00' })).toBe(0);
  });

  it('yalnızca 1–7 arası günleri kabul eder', () => {
    expect(isWeekday(1)).toBe(true);
    expect(isWeekday(7)).toBe(true);
    expect(isWeekday(0)).toBe(false);
    expect(isWeekday(8)).toBe(false);
  });

  it('her gün için Türkçe ad vardır', () => {
    expect(WEEKDAYS.map((day) => WEEKDAY_LABEL[day])).toEqual([
      'Pazartesi',
      'Salı',
      'Çarşamba',
      'Perşembe',
      'Cuma',
      'Cumartesi',
      'Pazar',
    ]);
  });
});
