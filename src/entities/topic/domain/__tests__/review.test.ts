import { accuracyLabel, latestReviewByTopic, memoryOf, qualityLabel } from '../review';

describe('tekrar geçmişi okuması', () => {
  it('aralığın yarısı geçince hafıza "zayıflıyor" olur, günü gelince "tekrar zamanı"', () => {
    const topic = { nextReviewOn: '2026-10-07', intervalDays: 6 };
    expect(memoryOf(topic, '2026-10-02').state).toBe('fresh'); // 1/6 geçti
    expect(memoryOf(topic, '2026-10-05').state).toBe('fading'); // 4/6 geçti
    expect(memoryOf(topic, '2026-10-07')).toEqual({ state: 'due', elapsed: 1, label: 'Tekrar zamanı' });
    expect(memoryOf(topic, '2026-10-09')).toEqual({ state: 'overdue', elapsed: 1, label: '2 gün gecikti' });
    expect(memoryOf({ nextReviewOn: null, intervalDays: 0 }, '2026-10-01').state).toBe('new');
  });

  it('her konunun en son tekrarı bulunur', () => {
    const latest = latestReviewByTopic([
      { topicId: 'a', reviewedOn: '2026-09-28', createdAt: '2026-09-28T10:00:00Z' },
      { topicId: 'a', reviewedOn: '2026-09-30', createdAt: '2026-09-30T09:00:00Z' },
      { topicId: 'b', reviewedOn: '2026-09-29', createdAt: '2026-09-29T09:00:00Z' },
      { topicId: 'a', reviewedOn: '2026-09-30', createdAt: '2026-09-30T18:00:00Z' },
    ]);
    expect(latest.get('a')?.createdAt).toBe('2026-09-30T18:00:00Z');
    expect(latest.get('b')?.reviewedOn).toBe('2026-09-29');
  });

  it('kalite ve isabet öğrencinin anlayacağı dille yazılır', () => {
    expect(qualityLabel(1)).toEqual({ label: 'Hatırlayamadın', tone: 'danger' });
    expect(qualityLabel(3).tone).toBe('warning');
    expect(qualityLabel(5).label).toBe('Çok iyi');
    expect(accuracyLabel({ correctCount: 8, attemptedCount: 10 })).toBe('8/10 doğru');
    expect(accuracyLabel({ correctCount: null, attemptedCount: 10 })).toBeNull();
  });
});
