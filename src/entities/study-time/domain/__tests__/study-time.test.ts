import {
  entriesBetween,
  NO_TOPIC_LABEL,
  summarizeByCourse,
  summarizeByTopic,
  totalMinutes,
  type StudyEntry,
} from '../study-time';

const entry = (over: Partial<StudyEntry> & { id: string }): StudyEntry => ({
  source: 'timer',
  startedAt: '2026-09-22T09:00:00',
  minutes: 50,
  courseId: 'statik',
  courseLabel: 'ME201',
  topicId: 'kafes',
  topicTitle: 'Kafes sistemler',
  taskId: null,
  ...over,
});

describe('summarizeByTopic', () => {
  it('aynı konunun sürelerini toplar ve en çok çalışılanı öne alır', () => {
    const rows = summarizeByTopic([
      entry({ id: '1', minutes: 50 }),
      entry({ id: '2', minutes: 25, source: 'task', startedAt: '2026-09-24T20:00:00' }),
      entry({ id: '3', minutes: 90, topicId: 'cerceve', topicTitle: 'Çerçeveler' }),
    ]);

    expect(rows.map((row) => [row.title, row.minutes, row.sessions])).toEqual([
      ['Çerçeveler', 90, 1],
      ['Kafes sistemler', 75, 2],
    ]);
    expect(rows[1]?.lastStudiedOn).toBe('2026-09-24');
  });

  it('konusuz süreyi büyük olsa da en sona koyar', () => {
    const rows = summarizeByTopic([
      entry({ id: '1', minutes: 20 }),
      entry({ id: '2', minutes: 200, topicId: null, topicTitle: null }),
    ]);

    expect(rows.map((row) => row.title)).toEqual(['Kafes sistemler', NO_TOPIC_LABEL]);
  });
});

describe('summarizeByCourse', () => {
  it('dersleri toplam süreye göre sıralar', () => {
    const rows = summarizeByCourse([
      entry({ id: '1', minutes: 30 }),
      entry({ id: '2', minutes: 70, courseId: 'fizik', courseLabel: 'PHY202', topicId: 'gauss', topicTitle: 'Gauss' }),
      entry({ id: '3', minutes: 30, topicId: null, topicTitle: null }),
    ]);

    expect(rows.map((row) => [row.label, row.minutes, row.topics.length])).toEqual([
      ['PHY202', 70, 1],
      ['ME201', 60, 2],
    ]);
  });
});

describe('entriesBetween', () => {
  it('yalnızca aralıktaki günleri tutar', () => {
    const inRange = entriesBetween(
      [
        entry({ id: 'before', startedAt: '2026-09-20T23:00:00' }),
        entry({ id: 'in', startedAt: '2026-09-21T08:00:00' }),
        entry({ id: 'after', startedAt: '2026-09-28T08:00:00' }),
      ],
      '2026-09-21',
      '2026-09-27',
    );

    expect(inRange.map((item) => item.id)).toEqual(['in']);
    expect(totalMinutes(inRange)).toBe(50);
  });
});
