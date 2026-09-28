import { addDays, diffInDays, formatShortDate, todayLocal } from '../localDate';

describe('yerel tarih yardımcıları', () => {
  it('takvim günü cihazın yerel gününü verir', () => {
    // Yerel saatle 00:30 — UTC'ye çevrilirse bir önceki güne kayardı.
    expect(todayLocal(new Date(2026, 8, 23, 0, 30))).toBe('2026-09-23');
    expect(todayLocal(new Date(2026, 8, 23, 23, 45))).toBe('2026-09-23');
  });

  it('gün ekleme ay ve yıl sınırlarını geçer', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('gün farkı yönlü hesaplanır', () => {
    expect(diffInDays('2026-09-21', '2026-09-24')).toBe(3);
    expect(diffInDays('2026-09-24', '2026-09-21')).toBe(-3);
    expect(diffInDays('2026-09-24', '2026-09-24')).toBe(0);
  });

  it('kısa tarih Türkçe biçimlenir', () => {
    expect(formatShortDate('2026-09-23')).toMatch(/Eyl/);
  });
});
