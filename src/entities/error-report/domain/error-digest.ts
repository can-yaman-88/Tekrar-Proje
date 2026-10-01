import type { IsoDate } from '@contracts/enums.contract';

/** One failure, however many times and for however many students it happened. */
export interface ErrorGroup {
  fingerprint: string;
  source: 'app' | 'edge';
  /** `server`, `unknown`, or `<function>:<code>` for an Edge Function. */
  kind: string;
  /** The query, mutation or screen an app error came from (`["tasks","mission"]`). */
  location: string | null;
  /** The newest report's message. */
  message: string;
  count: number;
  users: number;
  firstSeen: string;
  lastSeen: string;
  appVersion: string | null;
  /** First seen inside the window. */
  isNew: boolean;
  /** Marked as fixed, then seen again after that. */
  isRegression: boolean;
  resolvedAt: string | null;
}

export interface ErrorDigest {
  from: string;
  to: string;
  total: number;
  /** The same length of time just before `from`. */
  previousTotal: number;
  groups: number;
  affectedUsers: number;
  newGroups: number;
  regressions: number;
  bySource: { app: number; edge: number };
  versions: { version: string | null; platform: string | null; count: number }[];
  /** At most ten groups: what came back first, then the most frequent. */
  top: ErrorGroup[];
}

export interface StoredDigest {
  weekStart: IsoDate;
  digest: ErrorDigest;
  notifiedAt: string | null;
}

export interface ErrorReport {
  id: string;
  createdAt: string;
  message: string;
  detail: Record<string, unknown> | null;
  appVersion: string | null;
  platform: string | null;
  /** A short tag per student: tells one from several, nothing more. */
  reporter: string | null;
}

export interface ErrorGroupDetail {
  reports: ErrorReport[];
  resolvedAt: string | null;
  note: string | null;
}

export type ErrorGroupStatus = 'regression' | 'new' | 'resolved' | 'open';

export const ERROR_GROUP_STATUS_LABEL: Record<ErrorGroupStatus, string> = {
  regression: 'Geri döndü',
  new: 'Yeni',
  resolved: 'Düzeltildi',
  open: 'Açık',
};

/** What to do about a group first: one that came back beats one never seen before. */
export function groupStatus(group: Pick<ErrorGroup, 'isRegression' | 'isNew' | 'resolvedAt'>): ErrorGroupStatus {
  if (group.isRegression) return 'regression';
  if (group.resolvedAt !== null) return 'resolved';
  if (group.isNew) return 'new';
  return 'open';
}

/**
 * Where a group happened, in words: the function and error code for the
 * server, the query or screen for the app (`tasks › mission`).
 */
export function groupPlace(group: Pick<ErrorGroup, 'source' | 'kind' | 'location'>): string {
  if (group.source === 'edge') return group.kind.replace(':', ' · ');
  const place = (group.location ?? '')
    .replace(/[[\]"]/g, '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' › ');
  return place || group.kind;
}

export const groupOrigin = (group: Pick<ErrorGroup, 'source'>): string =>
  group.source === 'edge' ? 'Sunucu' : 'Uygulama';

/** "geçen döneme göre 3 fazla" — the direction is what matters on a Monday. */
export function trendLabel(total: number, previous: number): string {
  if (total === previous) return previous === 0 ? 'önceki dönemde de hiç yoktu' : 'önceki dönemle aynı';
  if (previous === 0) return 'önceki dönemde hiç yoktu';
  const diff = total - previous;
  return diff > 0 ? `önceki döneme göre ${diff} fazla` : `önceki döneme göre ${-diff} az`;
}

/** The stack trace an app report carried, trimmed to what fits on a phone. */
export function stackOf(report: Pick<ErrorReport, 'detail'>, maxLines = 8): string | null {
  const stack = report.detail?.['stack'];
  if (typeof stack !== 'string' || stack.trim() === '') return null;
  return stack.split('\n').slice(0, maxLines).join('\n');
}

/** The details worth a line each: request id, status, operation, code. */
export function reportFacts(report: Pick<ErrorReport, 'detail' | 'appVersion' | 'platform'>): string[] {
  const facts: string[] = [];
  const detail = report.detail ?? {};
  const add = (label: string, value: unknown) => {
    if (typeof value === 'string' && value !== '') facts.push(`${label}: ${value}`);
    else if (typeof value === 'number') facts.push(`${label}: ${value}`);
  };
  if (report.appVersion || report.platform) {
    facts.push([report.platform, report.appVersion].filter(Boolean).join(' · '));
  }
  add('işlem', detail['operation']);
  add('kod', detail['code']);
  add('durum', detail['status']);
  add('istek', detail['requestId']);
  if (detail['previousRun'] === true) facts.push('önceki açılışta çöktü');
  return facts;
}
