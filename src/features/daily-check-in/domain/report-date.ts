import type { IsoDate } from '@contracts/enums.contract';
import { addDays, todayLocal } from '@shared/lib/date';

/**
 * Until this hour a report still belongs to the evening before — the same
 * boundary spaced-repetition apps use for where a study day ends.
 */
export const DAY_ROLLOVER_HOUR = 4;

/**
 * Which day a report is about.
 *
 * A student who finishes at half past midnight and writes "bugün 20 soru
 * çözdüm" means the day that just ended, not the one that began thirty minutes
 * ago. Filing it under the new date put the work on the wrong day, started the
 * review schedule a day late, and made "yarın vize var" point a day too far.
 */
export function reportDateFor(now: Date = new Date()): IsoDate {
  const today = todayLocal(now);
  return now.getHours() < DAY_ROLLOVER_HOUR ? addDays(today, -1) : today;
}
