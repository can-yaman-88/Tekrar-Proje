import type { IsoDate } from '@contracts/enums.contract';

const pad = (n: number) => String(n).padStart(2, '0');

/** Today's calendar date in the device timezone. */
export function todayLocal(now: Date = new Date()): IsoDate {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The device-local calendar day of a timestamp. `timestamp.slice(0, 10)` is
 * the UTC day, which puts a 01:30 study session in Istanbul on the day before.
 */
export function localDateOf(timestamp: string): IsoDate {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? timestamp.slice(0, 10) : todayLocal(parsed);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function diffInDays(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The app's copy is Turkish, so dates are formatted in Turkish too. */
export const APP_LOCALE = 'tr-TR';

export function formatLongDate(date: IsoDate, locale: string = APP_LOCALE): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
}

export function formatShortDate(date: IsoDate, locale: string = APP_LOCALE): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

/** Monday of the week containing `date`. */
export function weekStartOf(date: IsoDate): IsoDate {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}

/**
 * "bugün", "yarın", "3 gün sonra", "2 gün önce" — how far a date is from today,
 * in the words a student would use.
 */
export function formatRelativeDay(date: IsoDate, today: IsoDate): string {
  const days = diffInDays(today, date);
  if (days === 0) return 'bugün';
  if (days === 1) return 'yarın';
  if (days === -1) return 'dün';
  return days > 0 ? `${days} gün sonra` : `${-days} gün önce`;
}

/** "45 dk", "2 sa", "1 sa 25 dk" — a duration the way a student says it. */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} dk`;
  return rest === 0 ? `${hours} sa` : `${hours} sa ${rest} dk`;
}
