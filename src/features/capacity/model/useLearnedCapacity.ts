import {
  LOOKBACK_WEEKS,
  planningBudget,
  resolveCapacity,
  type CapacitySource,
  type WeekdayCapacity,
} from '@domain/capacity';
import { sessionMinutes, useClassSchedule, WEEKDAY_LABEL, WEEKDAY_SHORT, WEEKDAYS, type Weekday } from '@entities/class-session';
import { useProfile, useSetBlockedWeekdays, useSetCapacityOverrides } from '@entities/profile';
import { useCompletedSince } from '@entities/task';
import { useSessionsSince } from '@entities/task-session';
import { addDays, formatMinutes, formatShortDate, localDateOf, useToday } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { onlineManager } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

export type CapacityMode = 'auto' | 'manual' | 'closed';

export interface CapacityRow {
  weekday: Weekday;
  label: string;
  shortLabel: string;
  /** The day's budget before class hours; 0 for a closed day. */
  minutes: number;
  /** What the planner actually fills: class hours come off a budget that is only a guess. */
  budget: number;
  classMinutes: number;
  source: CapacitySource;
  /** "Öğrenildi", "Senin sayın", "Kapalı"… */
  sourceLabel: string;
  /** One line on where the number came from, in plain words. */
  detail: string;
  /** Kept for the bar colour and older callers. */
  isLearned: boolean;
  isBlocked: boolean;
  /** The student's own number for this day, when set. */
  override: number | null;
}

const SOURCE_LABEL: Record<CapacitySource, string> = {
  blocked: 'Kapalı',
  override: 'Senin sayın',
  learned: 'Öğrenildi',
  general: 'Genel tempon',
  default: 'Varsayılan',
};

const OVERRIDE_STEP = 15;
const MIN_OVERRIDE = 15;
const MAX_OVERRIDE = 600;

function describeDay(day: WeekdayCapacity, weeks: number): string {
  switch (day.source) {
    case 'blocked':
      return 'Bu güne hiç iş konmaz; kapattığın günde duran işler başka günlere taşınır.';
    case 'override':
      return day.observedMinutes === null
        ? 'Planlar senin girdiğin sayıyı kullanır.'
        : `Planlar senin sayını kullanır; geçmişin ~${formatMinutes(day.observedMinutes)} diyor.`;
    case 'learned':
      if (day.activeDays === 0) return `Son ${day.observations} haftada bu gün hiç çalışmadın — kapatmak ister misin?`;
      return `Son ${day.observations} haftada ${day.activeDays} kez çalıştın · ağırlıklı ort. ${formatMinutes(day.observedMinutes ?? 0)}.`;
    case 'general':
      return `Bu gün için henüz yeterli ölçüm yok; genel temponla hesaplanıyor (son ${weeks} hafta).`;
    case 'default':
      return 'Henüz geçmiş yok; görev bitirdikçe ya da süre tuttukça senin ritmine göre şekillenecek.';
  }
}

/**
 * The budget every planner uses, per weekday, and where each number came
 * from — the very function the Edge Functions run, on the same rows, so the
 * card and the plan can never disagree. Each day can be set by hand too.
 */
export function useLearnedCapacity() {
  const today = useToday();
  const windowStart = useMemo(() => addDays(today, -LOOKBACK_WEEKS * 7), [today]);
  const finished = useCompletedSince(windowStart);
  const sessions = useSessionsSince(windowStart);
  const schedule = useClassSchedule();
  const profile = useProfile();
  const setBlocked = useSetBlockedWeekdays();
  const setOverrides = useSetCapacityOverrides();
  const [editing, setEditing] = useState<Weekday | null>(null);

  const blocked = useMemo(() => profile.data?.blockedWeekdays ?? [], [profile.data?.blockedWeekdays]);
  const overrides = useMemo(() => profile.data?.capacityOverrides ?? {}, [profile.data?.capacityOverrides]);

  const view = useMemo(() => {
    const capacity = resolveCapacity({
      today,
      finished: (finished.data ?? []).map((task) => ({
        taskId: task.id,
        parentTaskId: task.parentTaskId,
        finishedOn: localDateOf(task.completedAt),
        estimatedMinutes: task.estimatedMinutes,
      })),
      timed: (sessions.data ?? []).flatMap((session) =>
        session.minutes === null
          ? []
          : [{ taskId: session.taskId, startedOn: localDateOf(session.startedAt), minutes: session.minutes }],
      ),
      blockedWeekdays: blocked,
      overrides,
    });

    // Labs included: they still fill the day.
    const classByWeekday = new Map<number, number>();
    for (const session of schedule.data ?? []) {
      classByWeekday.set(session.weekday, (classByWeekday.get(session.weekday) ?? 0) + sessionMinutes(session));
    }

    const rows: CapacityRow[] = WEEKDAYS.map((weekday) => {
      const day = capacity.days[weekday - 1] as WeekdayCapacity;
      const classMinutes = classByWeekday.get(weekday) ?? 0;
      return {
        weekday,
        label: WEEKDAY_LABEL[weekday],
        shortLabel: WEEKDAY_SHORT[weekday],
        minutes: day.minutes,
        budget: planningBudget(day, classMinutes),
        classMinutes,
        source: day.source,
        sourceLabel: SOURCE_LABEL[day.source],
        detail: describeDay(day, LOOKBACK_WEEKS),
        isLearned: day.source === 'learned',
        isBlocked: day.source === 'blocked',
        override: overrides[weekday] ?? null,
      };
    });

    const weeklyBudget = rows.reduce((sum, row) => sum + row.budget, 0);
    const historyLine =
      capacity.historyStart === null
        ? 'Henüz bitirilmiş iş ya da tutulmuş süre yok; şimdilik varsayılan bütçe kullanılıyor.'
        : `İlk kaydın ${formatShortDate(capacity.historyStart)}; o günden beri ${capacity.activeDays} gün çalıştın` +
          (capacity.averageMinutes === null ? '.' : `, günlük ortalaman ${formatMinutes(capacity.averageMinutes)}.`);

    return {
      rows,
      budgetByWeekday: Object.fromEntries(rows.map((row) => [row.weekday, row.budget])) as Record<number, number>,
      hasHistory: capacity.learnedWeekdays.length > 0,
      historyLine,
      weeklyBudgetLabel: formatMinutes(weeklyBudget),
      /** Days whose number came from the stopwatch rather than an estimate. */
      measuredDays: capacity.measuredDays,
      weeks: LOOKBACK_WEEKS,
    };
  }, [blocked, finished.data, overrides, schedule.data, sessions.data, today]);

  const { mutate: mutateBlocked } = setBlocked;
  const { mutate: mutateOverrides } = setOverrides;
  /**
   * Shows the new number at once; offline it waits in the queue (blocked days
   * before overrides, in the order they were made), and a refusal from the
   * server puts the old number back.
   */
  const save = useCallback(
    (weekday: Weekday, mode: CapacityMode, minutes: number | null) => {
      const nextBlocked =
        mode === 'closed' ? [...new Set([...blocked, weekday])] : blocked.filter((day) => day !== weekday);
      const nextOverrides: Record<number, number> = { ...overrides };
      if (mode === 'manual' && minutes !== null) nextOverrides[weekday] = minutes;
      if (mode === 'auto') delete nextOverrides[weekday];

      const onError = (error: Error) => showToast(`${describeError(error).message} Ayar geri alındı.`, 'danger');
      if (nextBlocked.length !== blocked.length) mutateBlocked(nextBlocked, { onError });
      if (JSON.stringify(nextOverrides) !== JSON.stringify(overrides)) mutateOverrides(nextOverrides, { onError });

      const label = WEEKDAY_LABEL[weekday];
      const queued = onlineManager.isOnline() ? '' : ' Bağlantı gelince kaydedilecek.';
      showToast(
        (mode === 'closed'
          ? `${label} kapatıldı; plan o güne iş koymayacak.`
          : mode === 'manual'
            ? `${label} için ${formatMinutes(minutes ?? 0)} ayarlandı.`
            : `${label} yeniden otomatik.`) + queued,
        'success',
      );
      setEditing(null);
    },
    [blocked, overrides, mutateBlocked, mutateOverrides],
  );

  return {
    ...view,
    isLoading: finished.isPending || profile.isPending,
    // Waiting for the network is not saving: the card already shows the change.
    isSaving: (setBlocked.isPending && !setBlocked.isPaused) || (setOverrides.isPending && !setOverrides.isPaused),
    editing,
    onEdit: (weekday: Weekday) => setEditing((current) => (current === weekday ? null : weekday)),
    onCloseEditor: () => setEditing(null),
    save,
    step: OVERRIDE_STEP,
    minOverride: MIN_OVERRIDE,
    maxOverride: MAX_OVERRIDE,
  };
}

export type CapacityController = ReturnType<typeof useLearnedCapacity>;
