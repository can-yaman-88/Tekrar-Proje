import { reportDateFor } from '../report-date';

describe('reportDateFor', () => {
  it('gece yarısından sonra yazılan rapor biten güne aittir', () => {
    expect(reportDateFor(new Date(2026, 8, 30, 0, 30))).toBe('2026-09-29');
    expect(reportDateFor(new Date(2026, 8, 30, 3, 59))).toBe('2026-09-29');
  });

  it('sabah dörtten sonra yeni gün başlar', () => {
    expect(reportDateFor(new Date(2026, 8, 30, 4, 0))).toBe('2026-09-30');
    expect(reportDateFor(new Date(2026, 8, 30, 22, 15))).toBe('2026-09-30');
  });

  it('ay başında önceki aya döner', () => {
    expect(reportDateFor(new Date(2026, 9, 1, 1, 0))).toBe('2026-09-30');
  });
});
