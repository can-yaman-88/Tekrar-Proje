import { useCourseTerms, useSetTermStart } from '@entities/course';
import { resolveTermStarts, teachingWeekOf, termStartFor } from '@domain/term';
import { formatShortDate, useToday } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useMemo, useState } from 'react';

const MAX_WEEK = 20;

/**
 * "Bu hafta dönemin kaçıncı haftası?" — the one fact the planner needs to tell
 * a topic that has been taught from one that has not. One answer is enough
 * for the whole semester; a course whose syllabus gave its own date keeps it.
 */
export function useTermWeek(courseId: string) {
  const today = useToday();
  const terms = useCourseTerms();
  const save = useSetTermStart();

  const resolved = useMemo(() => resolveTermStarts(terms.data ?? []), [terms.data]);
  const own = terms.data?.find((course) => course.id === courseId)?.termStartDate ?? null;
  const effective = resolved[courseId] ?? null;
  const currentWeek = effective === null ? null : teachingWeekOf(effective, today);

  // The stepper starts at the week the calendar already implies; only a change
  // the student makes is kept as their own.
  const [picked, setPicked] = useState<number | null>(null);
  const draft = picked ?? Math.min(MAX_WEEK, Math.max(1, currentWeek ?? 1));
  const [applyToAll, setApplyToAll] = useState(true);

  return {
    isLoading: terms.isPending,
    currentWeek,
    /** Where the number comes from, in one line. */
    sourceLabel:
      effective === null
        ? 'Dönem başlangıcı bilinmiyor: plan bütün haftaların konularını işlenmiş sayıyor.'
        : own !== null
          ? `1. hafta ${formatShortDate(effective)} haftası (bu dersin kaydından).`
          : `1. hafta ${formatShortDate(effective)} haftası (diğer derslerinden).`,
    draft,
    canDecrease: draft > 1,
    canIncrease: draft < MAX_WEEK,
    onDecrease: () => setPicked(Math.max(1, draft - 1)),
    onIncrease: () => setPicked(Math.min(MAX_WEEK, draft + 1)),
    applyToAll,
    onApplyToAll: setApplyToAll,
    isDirty: currentWeek === null || draft !== currentWeek,
    isSaving: save.isPending,
    onSave: () => {
      const termStartDate = termStartFor(today, draft);
      const courseIds = applyToAll ? (terms.data ?? []).map((course) => course.id) : [courseId];
      save.mutate(
        { courseIds: courseIds.length > 0 ? courseIds : [courseId], termStartDate },
        {
          onSuccess: () => {
            setPicked(null);
            showToast(
              `Kaydedildi: bu hafta ${draft}. hafta. Plan, sırası gelmemiş haftaların konularını beklemeye alır.`,
              'success',
            );
          },
          onError: (error) => showToast(describeError(error).message, 'danger'),
        },
      );
    },
  };
}

export type TermWeekController = ReturnType<typeof useTermWeek>;
