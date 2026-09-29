// Days and durations in the words the student uses.
//
// Three readers need them: the model, which must look a weekday up instead of
// counting to it; and the student, twice — in the list of what the report was
// read as, and in the answers to what they asked.
import type { IsoDate } from '../_shared/contracts/enums.contract.ts';
import { diffInDays, isoWeekday } from '../_shared/domain/dates.ts';

const WEEKDAY_TR = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const MONTH_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

/** "Pazartesi", for ISO weekday 1. */
export function weekdayName(weekday: number): string {
  return WEEKDAY_TR[weekday - 1] ?? '';
}

/** "Çarşamba 30 Eyl". */
export function dayName(date: IsoDate): string {
  const [, month, day] = date.split('-').map(Number);
  return `${weekdayName(isoWeekday(date))} ${day} ${MONTH_TR[(month ?? 1) - 1] ?? ''}`;
}

/** "bugün", "yarın", "dün", otherwise the day's name — relative to the report, not to the phone. */
export function relativeDay(date: IsoDate, logDate: IsoDate): string {
  switch (diffInDays(logDate, date)) {
    case 0:
      return 'bugün';
    case 1:
      return 'yarın';
    case -1:
      return 'dün';
    default:
      return dayName(date);
  }
}

/** "~45 dk", "~2 sa", "~1 sa 30 dk". */
export function formatMinutes(minutes: number): string {
  const rounded = Math.max(5, Math.round(minutes / 5) * 5);
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (hours === 0) return `~${rest} dk`;
  return rest === 0 ? `~${hours} sa` : `~${hours} sa ${rest} dk`;
}
