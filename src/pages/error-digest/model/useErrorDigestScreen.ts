import type { IsoDate } from '@contracts/enums.contract';
import {
  ERROR_GROUP_STATUS_LABEL,
  groupOrigin,
  groupPlace,
  groupStatus,
  reportFacts,
  stackOf,
  trendLabel,
  useErrorGroup,
  useIsAdmin,
  useLiveErrorDigest,
  useSetErrorGroupResolved,
  useStoredErrorDigests,
  type ErrorDigest,
  type ErrorGroupStatus,
} from '@entities/error-report';
import { formatRelativeDay, formatShortDate, localDateOf, useToday } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useCallback, useMemo, useState } from 'react';

export type DigestPeriod = '7' | '30' | 'weeks';

export const PERIOD_OPTIONS: readonly { value: DigestPeriod; label: string }[] = [
  { value: '7', label: 'Son 7 gün' },
  { value: '30', label: 'Son 30 gün' },
  { value: 'weeks', label: 'Haftalık' },
];

export interface DigestTile {
  key: string;
  value: number;
  label: string;
  tone: 'default' | 'danger' | 'warning';
}

export interface GroupRow {
  fingerprint: string;
  place: string;
  origin: string;
  message: string;
  /** "4 kez · 2 öğrenci" */
  countLabel: string;
  /** "ilk 21 Eyl · son 3 gün önce" */
  seenLabel: string;
  status: ErrorGroupStatus;
  statusLabel: string;
  isResolved: boolean;
}

export interface ReportRow {
  id: string;
  timeLabel: string;
  message: string;
  facts: string[];
  stack: string | null;
  reporter: string | null;
}

const timeOf = (timestamp: string) =>
  new Date(timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

function tilesOf(digest: ErrorDigest): DigestTile[] {
  return [
    { key: 'total', value: digest.total, label: 'hata', tone: 'default' },
    { key: 'groups', value: digest.groups, label: 'grup', tone: 'default' },
    { key: 'users', value: digest.affectedUsers, label: 'öğrenci', tone: 'default' },
    { key: 'new', value: digest.newGroups, label: 'yeni grup', tone: digest.newGroups > 0 ? 'warning' : 'default' },
    {
      key: 'back',
      value: digest.regressions,
      label: 'geri dönen',
      tone: digest.regressions > 0 ? 'danger' : 'default',
    },
  ];
}

/**
 * The admin's error page: what broke in a period, grouped, with the reports
 * behind each group one tap away and a way to say "this one is fixed".
 */
export function useErrorDigestScreen() {
  const today = useToday();
  const admin = useIsAdmin();
  const isAdmin = admin.data === true;
  const [period, setPeriod] = useState<DigestPeriod>('7');
  const [weekStart, setWeekStart] = useState<IsoDate | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [isRefreshing, setRefreshing] = useState(false);

  const days = period === '30' ? 30 : 7;
  const live = useLiveErrorDigest(days, isAdmin && period !== 'weeks');
  const stored = useStoredErrorDigests(isAdmin && period === 'weeks');
  const group = useErrorGroup(expanded);
  const resolve = useSetErrorGroupResolved();

  const weeks = useMemo(() => stored.data ?? [], [stored.data]);
  const selectedWeek = weeks.find((week) => week.weekStart === weekStart) ?? weeks[0] ?? null;
  const digest: ErrorDigest | null = period === 'weeks' ? (selectedWeek?.digest ?? null) : (live.data ?? null);
  const active = period === 'weeks' ? stored : live;

  const view = useMemo(() => {
    if (!digest) return null;
    const versions = digest.versions
      .map((v) => `${[v.platform, v.version].filter(Boolean).join(' ') || 'bilinmiyor'}: ${v.count}`)
      .join(' · ');
    return {
      tiles: tilesOf(digest),
      trend: trendLabel(digest.total, digest.previousTotal),
      sourceLine: `Uygulama ${digest.bySource.app} · Sunucu ${digest.bySource.edge}`,
      versionsLine: versions || null,
      groups: digest.top.map(
        (g): GroupRow => ({
          fingerprint: g.fingerprint,
          place: groupPlace(g),
          origin: groupOrigin(g),
          message: g.message,
          countLabel: `${g.count} kez${g.users > 0 ? ` · ${g.users} öğrenci` : ''}`,
          seenLabel: `ilk ${formatShortDate(localDateOf(g.firstSeen))} · son ${formatRelativeDay(localDateOf(g.lastSeen), today)}`,
          status: groupStatus(g),
          statusLabel: ERROR_GROUP_STATUS_LABEL[groupStatus(g)],
          isResolved: g.resolvedAt !== null && !g.isRegression,
        }),
      ),
      moreGroups: Math.max(0, digest.groups - digest.top.length),
    };
  }, [digest, today]);

  const reports: ReportRow[] = useMemo(
    () =>
      (group.data?.reports ?? []).map((report) => ({
        id: report.id,
        timeLabel: `${formatShortDate(localDateOf(report.createdAt))} ${timeOf(report.createdAt)}`,
        message: report.message,
        facts: reportFacts(report),
        stack: stackOf(report),
        reporter: report.reporter,
      })),
    [group.data],
  );

  const { refetch: refetchActive } = active;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetchActive();
    } finally {
      setRefreshing(false);
    }
  }, [refetchActive]);

  const { mutate: resolveMutate } = resolve;
  const onResolve = useCallback(
    (fingerprint: string, resolved: boolean) =>
      resolveMutate(
        { fingerprint, resolved },
        {
          onSuccess: () =>
            showToast(
              resolved ? 'Düzeltildi olarak işaretlendi; yeniden görülürse "geri döndü" diye çıkar.' : 'Grup yeniden açıldı.',
              'success',
            ),
          onError: (error) => showToast(describeError(error).message, 'danger'),
        },
      ),
    [resolveMutate],
  );

  const failed = admin.isError ? admin : active.isError && active.data === undefined ? active : null;

  return {
    isCheckingAccess: admin.isPending,
    isAdmin,
    isLoading: isAdmin && active.isPending && active.data === undefined,
    error: failed ? describeError(failed.error) : null,
    retry: () => void (admin.isError ? admin.refetch() : refresh()),
    isRefreshing,
    refresh,
    period,
    onPeriod: (next: DigestPeriod) => {
      setPeriod(next);
      setExpanded(null);
    },
    weeks: weeks.map((week) => ({
      weekStart: week.weekStart,
      label: `${formatShortDate(week.weekStart)} haftası`,
      total: week.digest.total,
      isSelected: week.weekStart === selectedWeek?.weekStart,
    })),
    onWeek: (next: IsoDate) => {
      setWeekStart(next);
      setExpanded(null);
    },
    periodLabel:
      period === 'weeks'
        ? selectedWeek
          ? `${formatShortDate(selectedWeek.weekStart)} haftası (pazartesi–pazar)`
          : null
        : `Son ${days} gün`,
    view,
    expanded,
    onToggleGroup: (fingerprint: string) => setExpanded((current) => (current === fingerprint ? null : fingerprint)),
    detail: {
      isLoading: group.isPending && expanded !== null,
      error: group.isError ? describeError(group.error).message : null,
      reports,
      note: group.data?.note ?? null,
    },
    onResolve,
    resolvingFingerprint: resolve.isPending ? (resolve.variables?.fingerprint ?? null) : null,
  };
}

export type ErrorDigestController = ReturnType<typeof useErrorDigestScreen>;
