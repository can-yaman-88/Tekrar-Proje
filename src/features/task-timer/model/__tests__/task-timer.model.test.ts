import { estimateModel, parseManualMinutes, sessionRow } from '../task-timer.model';

describe('estimateModel', () => {
  it('açık görevde kalan süreyi söyler', () => {
    const view = estimateModel(30, 45, true);
    expect(view?.ratio).toBeCloseTo(30 / 45);
    expect(view?.isOver).toBe(false);
    expect(view?.label).toContain('15 dk kaldı');
  });

  it('aşınca uyarır ve çubuğu doldurur', () => {
    const view = estimateModel(70, 45, true);
    expect(view?.ratio).toBe(1);
    expect(view?.isOver).toBe(true);
    expect(view?.label).toContain('25 dk aştı');
  });

  it('kapanmış görevde tahminin tutup tutmadığını söyler', () => {
    expect(estimateModel(47, 45, false)?.label).toContain('tahmin tuttu');
    expect(estimateModel(80, 45, false)?.label).toContain('35 dk daha uzun sürdü');
    expect(estimateModel(20, 45, false)?.label).toContain('25 dk daha kısa sürdü');
  });

  it('tahmin yoksa bir şey göstermez', () => {
    expect(estimateModel(30, null, true)).toBeNull();
    expect(estimateModel(30, 0, true)).toBeNull();
  });
});

describe('parseManualMinutes', () => {
  it('1–240 arasını kabul eder', () => {
    expect(parseManualMinutes('35')).toBe(35);
    expect(parseManualMinutes(' 240 ')).toBe(240);
    expect(parseManualMinutes('0')).toBeNull();
    expect(parseManualMinutes('241')).toBeNull();
    expect(parseManualMinutes('')).toBeNull();
  });
});

describe('sessionRow', () => {
  it('saati, kaynağı ve grup adımını yazar', () => {
    const row = sessionRow(
      {
        id: 's1',
        taskId: 'step',
        startedAt: '2026-10-02T14:05:00',
        endedAt: '2026-10-02T14:45:00',
        minutes: 40,
        clock: 'focus_timer',
      },
      new Map([['step', 'Feynman sayfası']]),
    );
    expect(row.whenLabel).toContain('14:05');
    expect(row.minutesLabel).toBe('40 dk');
    expect(row.detail).toBe('Focus Timer · Feynman sayfası');
  });
});
