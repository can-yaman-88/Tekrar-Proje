import type { DailyCheckinResponse } from '@contracts/daily-checkin.contract';
import { showToast } from '@shared/lib/toast';
import { useEffect, useRef } from 'react';
import { cancelReportReminders, ensurePermission, scheduleReportReminders } from '../data/notifications';

/**
 * Turns a check-in's answer into notifications on this phone: the reminders
 * the report asked for, and — when it undid an earlier report — the removal of
 * that report's reminders. Runs once per check-in, however often it re-renders.
 */
export function useReportReminders(result: DailyCheckinResponse | null): void {
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!result || handled.current === result.dailyLogId) return;
    handled.current = result.dailyLogId;

    void (async () => {
      if (result.undoneLogId) await cancelReportReminders(result.undoneLogId);
      if (result.reminders.length === 0) return;
      if (!(await ensurePermission())) {
        showToast('Bildirim izni kapalı; hatırlatma kurulamadı.', 'danger');
        return;
      }
      const { scheduled, past } = await scheduleReportReminders(result.dailyLogId, result.reminders);
      if (scheduled > 0) showToast(`${scheduled} hatırlatma kuruldu.`, 'success');
      if (past > 0) showToast(`${past} hatırlatmanın saati geçmiş; kurulmadı.`, 'info');
    })().catch(() => showToast('Hatırlatma kurulamadı.', 'danger'));
  }, [result]);
}
