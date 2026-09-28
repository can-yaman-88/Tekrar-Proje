import { buildWeekSummary, type SummarySession, type SummaryTask, type SummaryTopic } from '../weekly-summary';

const task = (over: Partial<SummaryTask> & { id: string }): SummaryTask => ({
  type: 'quiz',
  group: 'quiz',
  status: 'completed',
  dueDate: '2026-09-21',
  estimatedMinutes: 30,
  topicId: 'topic-1',
  topicTitle: 'Entropi',
  courseLabel: 'ME201',
  ...over,
});

const session = (over: Partial<SummarySession> & { taskId: string }): SummarySession => ({
  taskType: 'quiz',
  startedAt: '2026-09-21T18:00:00Z',
  minutes: 45,
  estimatedMinutes: 30,
  ...over,
});

const topic = (over: Partial<SummaryTopic> & { id: string }): SummaryTopic => ({
  title: 'Entropi',
  courseLabel: 'ME201',
  easeFactor: 2.5,
  nextReviewOn: null,
  failedTasks: 0,
  ...over,
});

const WEEK_START = '2026-09-21'; // Pazartesi

describe('buildWeekSummary', () => {
  it('haftanın dışındaki görevleri saymaz', () => {
    const summary = buildWeekSummary({
      weekStart: WEEK_START,
      tasks: [task({ id: 'in' }), task({ id: 'out', dueDate: '2026-09-28' })],
      sessions: [],
      checkinDates: [],
      topics: [],
    });

    expect(summary.total).toBe(1);
    expect(summary.completed).toBe(1);
  });

  it('ölçülen süre varsa tahmini değil onu gösterir', () => {
    const summary = buildWeekSummary({
      weekStart: WEEK_START,
      tasks: [task({ id: 'a' })],
      sessions: [session({ taskId: 'a' })],
      checkinDates: [],
      topics: [],
    });

    expect(summary.hasMeasuredTime).toBe(true);
    expect(summary.measuredMinutes).toBe(45);
    expect(summary.estimatedMinutes).toBe(30);
    expect(summary.byDay[0]?.minutes).toBe(45);
  });

  it('süre tutulmamış günde tahmine düşer', () => {
    const summary = buildWeekSummary({
      weekStart: WEEK_START,
      tasks: [task({ id: 'a' })],
      sessions: [],
      checkinDates: [],
      topics: [],
    });

    expect(summary.hasMeasuredTime).toBe(false);
    expect(summary.byDay[0]?.minutes).toBe(30);
  });

  it('tek örnekli türü kalibrasyona sokmaz', () => {
    const one = buildWeekSummary({
      weekStart: WEEK_START,
      tasks: [task({ id: 'a' })],
      sessions: [session({ taskId: 'a' })],
      checkinDates: [],
      topics: [],
    });
    expect(one.calibration).toHaveLength(0);

    const two = buildWeekSummary({
      weekStart: WEEK_START,
      tasks: [task({ id: 'a' }), task({ id: 'b' })],
      sessions: [session({ taskId: 'a' }), session({ taskId: 'b', minutes: 35 })],
      checkinDates: [],
      topics: [],
    });
    expect(two.calibration).toEqual([
      { label: '10 soruluk sınav', estimated: 30, actual: 40, samples: 2 },
    ]);
  });

  it('takılınan ve gelecek hafta tekrarı gelen konuları ayırır', () => {
    const summary = buildWeekSummary({
      weekStart: WEEK_START,
      tasks: [task({ id: 'a', status: 'failed', topicId: 'weak' })],
      sessions: [],
      checkinDates: [],
      topics: [
        topic({ id: 'weak', title: 'Carnot' }),
        topic({ id: 'later', title: 'Kafesler', nextReviewOn: '2026-09-30' }),
        topic({ id: 'far', title: 'Akışkanlar', nextReviewOn: '2026-11-01' }),
      ],
    });

    expect(summary.struggling.map((t) => t.title)).toEqual(['Carnot']);
    expect(summary.nextWeekReviews.map((t) => t.title)).toEqual(['Kafesler']);
  });

  it('değerlendirme günlerini haftaya göre sayar, tekrarları birleştirir', () => {
    const summary = buildWeekSummary({
      weekStart: WEEK_START,
      tasks: [],
      sessions: [],
      checkinDates: ['2026-09-21', '2026-09-21', '2026-09-22', '2026-09-14'],
      topics: [],
    });

    expect(summary.checkinDays).toBe(2);
    expect(summary.headline).toBe('Bu hafta planlanmış iş yoktu.');
  });

  it('düşük tamamlanmada nedeni söyler', () => {
    const tasks = Array.from({ length: 10 }, (_, i) =>
      task({ id: `t${i}`, status: i < 3 ? 'completed' : 'pending' }),
    );
    const lazyCheckins = buildWeekSummary({ weekStart: WEEK_START, tasks, sessions: [], checkinDates: [], topics: [] });
    expect(lazyCheckins.headline).toContain('Değerlendirme az yazıldığı');

    const manyCheckins = buildWeekSummary({
      weekStart: WEEK_START,
      tasks,
      sessions: [],
      checkinDates: ['2026-09-21', '2026-09-22', '2026-09-23'],
      topics: [],
    });
    expect(manyCheckins.headline).toContain('kapasiteyi düşürmek');
  });
});
