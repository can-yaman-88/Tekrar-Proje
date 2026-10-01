import type { IsoDate } from '@contracts/enums.contract';
import { dayToShow, type WidgetSnapshot, type WidgetTaskItem } from './widget-snapshot';

/** The app's deep links (scheme `tekrar`, app.config.ts). */
export const taskUri = (taskId: string) => `tekrar://task/${taskId}`;
export const CHECK_IN_URI = 'tekrar://check-in';
/** A widget click the background task handles: tick this task. */
export const COMPLETE_ACTION = 'COMPLETE_TASK';

export interface WidgetRow extends WidgetTaskItem {
  /** "30 dk", "gecikti" — the one fact worth a glance. */
  badge: string | null;
}

export type WidgetView =
  | { kind: 'signedOut' }
  | { kind: 'stale' }
  | {
      kind: 'day';
      title: string;
      /** "2/5" — done of the day's work, null when there is none. */
      progress: string | null;
      rows: WidgetRow[];
      /** "+3 iş daha" */
      more: string | null;
      /** "Bugünün işleri bitti." when nothing is left. */
      empty: string | null;
      reviews: string | null;
      notice: string | null;
    };

/** Header, footer and padding, in dp; the rest is rows. */
const CHROME_DP = 92;
const ROW_DP = 36;
const MAX_ROWS = 6;

export const rowsThatFit = (heightDp: number): number =>
  Math.max(1, Math.min(MAX_ROWS, Math.floor((heightDp - CHROME_DP) / ROW_DP)));

const dayTitle = (date: IsoDate) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'short' });

const badgeOf = (item: WidgetTaskItem): string | null => {
  if (item.isOverdue) return 'gecikti';
  if (item.isUrgent) return 'acil';
  return item.minutes ? `${item.minutes} dk` : null;
};

/**
 * What to draw, for the space the widget has. Pure: the background task and
 * the app both call it with the same snapshot and get the same picture.
 */
export function buildWidgetView({
  snapshot,
  today,
  heightDp,
  signedIn,
  notice = null,
}: {
  snapshot: WidgetSnapshot | null;
  today: IsoDate;
  heightDp: number;
  signedIn: boolean;
  notice?: string | null;
}): WidgetView {
  if (!signedIn) return { kind: 'signedOut' };
  const day = dayToShow(snapshot, today);
  if (!day) return { kind: 'stale' };

  const fit = rowsThatFit(heightDp);
  const total = day.done + day.openTotal;
  const rows = day.open.slice(0, fit).map((item) => ({ ...item, badge: badgeOf(item) }));
  const hidden = day.openTotal - rows.length;
  return {
    kind: 'day',
    title: dayTitle(day.date),
    progress: total > 0 ? `${day.done}/${total}` : null,
    rows,
    more: hidden > 0 ? `+${hidden} iş daha` : null,
    empty: day.openTotal > 0 ? null : day.done > 0 ? 'Bugünün işleri bitti.' : 'Bugün için iş yok.',
    reviews: day.reviewsDue > 0 ? `${day.reviewsDue} konu tekrar bekliyor` : null,
    notice,
  };
}
