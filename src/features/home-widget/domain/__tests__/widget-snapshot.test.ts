import type { Task } from '@entities/task';
import { buildWidgetSnapshot, dayToShow, markDone, parseSnapshot } from '../widget-snapshot';

const TODAY = '2026-10-01';

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  type: 'problem_set',
  title: `Görev ${id}`,
  instructions: null,
  targetCount: null,
  completedCount: 0,
  correctCount: null,
  estimatedMinutes: 30,
  dueDate: TODAY,
  startsOn: null,
  dayAllocations: null,
  parentTaskId: null,
  status: 'pending',
  confidenceLevel: null,
  source: 'manual',
  isPriority: false,
  completedAt: null,
  topic: { id: `top-${id}`, title: 'Gauss yasası' },
  course: { id: 'c1', name: 'Fizik 2', code: 'FİZ102', colorHex: null },
  attachmentCount: 0,
  ...over,
});

const NOW = new Date('2026-10-01T09:00:00Z');

describe('widget snapshot', () => {
  it('lists today’s open work, overdue and urgent first, and counts what is done', () => {
    const snapshot = buildWidgetSnapshot({
      today: TODAY,
      board: [
        task('a'),
        task('late', { dueDate: '2026-09-29' }),
        task('urgent', { isPriority: true }),
        task('done', { status: 'completed', completedAt: '2026-10-01T08:00:00Z' }),
      ],
      upcoming: [],
      reviewDates: ['2026-09-30', '2026-10-01', '2026-10-02', null],
      now: NOW,
    });
    const today = dayToShow(snapshot, TODAY);
    expect(today?.open.map((item) => item.id)).toEqual(['late', 'urgent', 'a']);
    expect(today?.open[0]?.isOverdue).toBe(true);
    expect(today?.open[1]?.context).toBe('FİZ102 · Gauss yasası');
    expect(today?.done).toBe(1);
    expect(today?.openTotal).toBe(3);
    expect(today?.reviewsDue).toBe(2);
  });

  it('turns the page at midnight without the app: tomorrow carries today’s open work as overdue', () => {
    const snapshot = buildWidgetSnapshot({
      today: TODAY,
      board: [task('a')],
      upcoming: [task('tomorrow', { dueDate: '2026-10-02' }), task('later', { dueDate: '2026-10-03' })],
      reviewDates: ['2026-10-02'],
      now: NOW,
    });
    expect(snapshot.days.map((day) => day.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    const tomorrow = dayToShow(snapshot, '2026-10-02');
    expect(tomorrow?.open.map((item) => [item.id, item.isOverdue])).toEqual([
      ['a', true],
      ['tomorrow', false],
    ]);
    expect(tomorrow?.reviewsDue).toBe(1);
    expect(dayToShow(snapshot, '2026-10-03')?.open.map((item) => item.id)).toEqual(['a', 'tomorrow', 'later']);
    // Past the third day the widget has nothing true to say.
    expect(dayToShow(snapshot, '2026-10-04')).toBeNull();
  });

  it('shows a group once, and sends reviews and mixed sets to the app', () => {
    const snapshot = buildWidgetSnapshot({
      today: TODAY,
      board: [
        task('set', { type: 'mock_exam', source: 'exam_cram' }),
        task('step', { parentTaskId: 'set' }),
        task('review', { source: 'spaced_repetition', type: 'feynman' }),
      ],
      upcoming: [],
      reviewDates: [],
      now: NOW,
    });
    const today = dayToShow(snapshot, TODAY);
    expect(today?.open.map((item) => [item.id, item.needsApp])).toEqual([
      ['set', true],
      ['review', true],
    ]);
  });

  it('takes a tick at once and survives the round trip through storage', () => {
    const snapshot = buildWidgetSnapshot({ today: TODAY, board: [task('a'), task('b')], upcoming: [], reviewDates: [], now: NOW });
    const ticked = markDone(snapshot, 'a');
    expect(dayToShow(ticked, TODAY)?.open.map((item) => item.id)).toEqual(['b']);
    expect(dayToShow(ticked, TODAY)?.done).toBe(1);
    expect(dayToShow(ticked, TODAY)?.openTotal).toBe(1);
    // Tomorrow no longer carries it either.
    expect(dayToShow(ticked, '2026-10-02')?.open.map((item) => item.id)).toEqual(['b']);

    expect(parseSnapshot(JSON.stringify(ticked))).toEqual(ticked);
    expect(parseSnapshot('{bozuk')).toBeNull();
    expect(parseSnapshot(null)).toBeNull();
  });
});
