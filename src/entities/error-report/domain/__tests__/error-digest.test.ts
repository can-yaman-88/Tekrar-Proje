import { groupPlace, groupStatus, reportFacts, stackOf, trendLabel } from '../error-digest';

describe('groupPlace', () => {
  it('reads an app query key as a path', () => {
    expect(groupPlace({ source: 'app', kind: 'server', location: '["tasks","mission"]' })).toBe('tasks › mission');
  });
  it('names the function and code for a server failure', () => {
    expect(groupPlace({ source: 'edge', kind: 'daily-checkin:llm_error', location: null })).toBe(
      'daily-checkin · llm_error',
    );
  });
  it('falls back to the kind when the app said nothing about where', () => {
    expect(groupPlace({ source: 'app', kind: 'unknown', location: null })).toBe('unknown');
    expect(groupPlace({ source: 'app', kind: 'unknown', location: '[]' })).toBe('unknown');
  });
});

describe('groupStatus', () => {
  it('puts a regression above everything else', () => {
    expect(groupStatus({ isRegression: true, isNew: true, resolvedAt: '2026-09-30T10:00:00Z' })).toBe('regression');
  });
  it('keeps a fixed group fixed while it stays quiet', () => {
    expect(groupStatus({ isRegression: false, isNew: false, resolvedAt: '2026-09-30T10:00:00Z' })).toBe('resolved');
  });
  it('tells new from old', () => {
    expect(groupStatus({ isRegression: false, isNew: true, resolvedAt: null })).toBe('new');
    expect(groupStatus({ isRegression: false, isNew: false, resolvedAt: null })).toBe('open');
  });
});

describe('trendLabel', () => {
  it('says which way it went', () => {
    expect(trendLabel(7, 4)).toBe('önceki döneme göre 3 fazla');
    expect(trendLabel(2, 5)).toBe('önceki döneme göre 3 az');
    expect(trendLabel(3, 3)).toBe('önceki dönemle aynı');
    expect(trendLabel(3, 0)).toBe('önceki dönemde hiç yoktu');
    expect(trendLabel(0, 0)).toBe('önceki dönemde de hiç yoktu');
  });
});

describe('report details', () => {
  it('keeps the top of a stack trace', () => {
    const stack = Array.from({ length: 20 }, (_, i) => `at frame${i}`).join('\n');
    expect(stackOf({ detail: { stack } })?.split('\n')).toHaveLength(8);
    expect(stackOf({ detail: { stack: '   ' } })).toBeNull();
    expect(stackOf({ detail: null })).toBeNull();
  });
  it('lists what helps to find it', () => {
    expect(
      reportFacts({
        detail: { operation: 'tasks.list', code: 'XX000', requestId: 'r-1', status: 502, previousRun: true },
        appVersion: '1.0.0',
        platform: 'android',
      }),
    ).toEqual(['android · 1.0.0', 'işlem: tasks.list', 'kod: XX000', 'durum: 502', 'istek: r-1', 'önceki açılışta çöktü']);
  });
});
