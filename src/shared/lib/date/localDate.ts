import type { IsoDate } from '@contracts/enums.contract';

const pad = (n: number) => String(n).padStart(2, '0');

/** Today's calendar date in the device timezone. */
export function todayLocal(now: Date = new Date()): IsoDate {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
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
