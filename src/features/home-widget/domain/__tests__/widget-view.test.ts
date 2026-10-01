import { buildWidgetView, rowsThatFit } from '../widget-view';
import type { WidgetSnapshot } from '../widget-snapshot';

const item = (id: string, over: Partial<WidgetSnapshot['days'][number]['open'][number]> = {}) => ({
  id,
  title: `Görev ${id}`,
  context: 'FİZ102 · Gauss',
  minutes: 30,
  isOverdue: false,
  isUrgent: false,
  needsApp: false,
  ...over,
});

const snapshot: WidgetSnapshot = {
  version: 1,
  generatedAt: '2026-10-01T09:00:00Z',
  days: [
    {
      date: '2026-10-01',
      open: [item('late', { isOverdue: true }), item('urgent', { isUrgent: true }), item('a'), item('b', { minutes: null })],
      openTotal: 5,
      done: 2,
      reviewsDue: 3,
    },
    { date: '2026-10-02', open: [], openTotal: 0, done: 0, reviewsDue: 0 },
  ],
};

describe('widget view', () => {
  it('fits rows to the height it is given', () => {
    expect(rowsThatFit(110)).toBe(1);
    expect(rowsThatFit(200)).toBe(3);
    expect(rowsThatFit(1000)).toBe(6);
  });

  it('draws the day: progress, badges, the rest as a count', () => {
    const view = buildWidgetView({ snapshot, today: '2026-10-01', heightDp: 200, signedIn: true });
    if (view.kind !== 'day') throw new Error(view.kind);
    expect(view.progress).toBe('2/7');
    expect(view.rows.map((row) => row.badge)).toEqual(['gecikti', 'acil', '30 dk']);
    expect(view.more).toBe('+2 iş daha');
    expect(view.reviews).toBe('3 konu tekrar bekliyor');
    expect(view.empty).toBeNull();
  });

  it('says so when the day is clear, signed out, or out of date', () => {
    const tomorrow = buildWidgetView({ snapshot, today: '2026-10-02', heightDp: 200, signedIn: true });
    expect(tomorrow.kind === 'day' && tomorrow.empty).toBe('Bugün için iş yok.');
    expect(buildWidgetView({ snapshot, today: '2026-10-01', heightDp: 200, signedIn: false }).kind).toBe('signedOut');
    expect(buildWidgetView({ snapshot, today: '2026-10-09', heightDp: 200, signedIn: true }).kind).toBe('stale');
    expect(buildWidgetView({ snapshot: null, today: '2026-10-01', heightDp: 200, signedIn: true }).kind).toBe('stale');
  });
});
