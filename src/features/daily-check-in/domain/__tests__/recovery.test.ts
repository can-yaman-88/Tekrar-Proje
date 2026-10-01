import type { CheckinOutcome } from '@entities/daily-log';
import { decideRecovery } from '../recovery';

const succeeded: CheckinOutcome = {
  state: 'succeeded',
  result: {
    dailyLogId: 'log',
    summary: 'özet',
    changes: [],
    answers: [],
    reminders: [],
    undoneLogId: null,
    coveredDates: ['2026-09-28'],
    attachmentNotes: [],
    updatedTaskIds: [],
    createdTaskIds: [],
    removedTaskIds: [],
    movedTaskIds: [],
    mistakesRecorded: 0,
    reviewedTopicIds: [],
    scheduledReviews: [],
    unmatchedMentions: [],
  },
};

describe('decideRecovery', () => {
  it('sunucuda tamamlanmışsa hata değil sonuç gösterilir', () => {
    // Telefon "başarısız" sansa bile: iş gerçekten yapıldıysa sonucu göster.
    expect(decideRecovery(succeeded)).toEqual({ action: 'use-result' });
  });

  it('sunucu işi aldıysa bağlantı kopsa da beklenir', () => {
    expect(decideRecovery({ state: 'processing' })).toEqual({ action: 'wait' });
  });

  it('sunucu işi almadıysa beklenmez, gerçek hata gösterilir', () => {
    expect(decideRecovery({ state: 'pending' })).toEqual({ action: 'report-error' });
  });

  it('sunucuda başarısız olduysa ya da kayıt yoksa hata gösterilir', () => {
    expect(decideRecovery({ state: 'failed', message: 'x' })).toEqual({ action: 'report-error' });
    expect(decideRecovery({ state: 'missing' })).toEqual({ action: 'report-error' });
  });
});
