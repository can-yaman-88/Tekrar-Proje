import type { CheckinOutcome } from '@entities/daily-log';
import { decideRecovery } from '../recovery';

const succeeded: CheckinOutcome = {
  state: 'succeeded',
  result: {
    dailyLogId: 'log',
    summary: 'özet',
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
    expect(decideRecovery({ outcome: succeeded, serverHasIt: true })).toEqual({ action: 'use-result' });
    // Telefon "başarısız" sansa bile: iş gerçekten yapıldıysa sonucu göster.
    expect(decideRecovery({ outcome: succeeded, serverHasIt: false })).toEqual({ action: 'use-result' });
  });

  it('sunucu işi aldığını söylediyse beklenir', () => {
    expect(decideRecovery({ outcome: { state: 'processing' }, serverHasIt: true })).toEqual({ action: 'wait' });
  });

  it('sunucu işi almadıysa beklenmez, gerçek hata gösterilir', () => {
    expect(decideRecovery({ outcome: { state: 'processing' }, serverHasIt: false })).toEqual({
      action: 'report-error',
    });
  });

  it('sunucuda başarısız olduysa ya da kayıt yoksa hata gösterilir', () => {
    expect(decideRecovery({ outcome: { state: 'failed', message: 'x' }, serverHasIt: true })).toEqual({
      action: 'report-error',
    });
    expect(decideRecovery({ outcome: { state: 'missing' }, serverHasIt: true })).toEqual({
      action: 'report-error',
    });
  });
});
