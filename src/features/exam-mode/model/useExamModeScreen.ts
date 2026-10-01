import {
  daysUntil,
  EXAM_KIND_LABEL,
  useApplyCramPlan,
  useApplyExamRetro,
  useExamMode as useExamModeQuery,
  type CramTaskInput,
} from '@entities/exam';
import { taskKeys } from '@entities/task';
import { mistakeLabel, useTopicMistakesFor } from '@entities/topic-mistake';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { formatLongDate, todayLocal } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useCallback, useMemo, useState } from 'react';
import { buildCramPlan, CRAM_WINDOW_DAYS, MASTERY_LABEL, type CramPlan } from '../domain/cram-plan';
import { EXAM_OUTCOME_LABEL, type ExamOutcome } from '../domain/exam-retro';

export interface ReadinessRow {
  id: string;
  title: string;
  masteryLabel: string;
  mastery: 'weak' | 'fair' | 'solid';
  detail: string;
  /** Open entries from the mistake book, at most a couple. */
  mistakes: string[];
}

/** More than this in a countdown screen is noise, not preparation. */
const MAX_SHOWN_MISTAKES = 2;

/**
 * The exam screen: how ready each topic is, what to do on the days that are
 * left, and — once the exam is behind — what it meant for the review schedule.
 */
export interface ExamModeOptions {
  /** Minutes available per ISO weekday; the page supplies the learned budgets. */
  capacityByWeekday?: Readonly<Record<number, number>>;
}

export function useExamModeScreen(examId: string, { capacityByWeekday }: ExamModeOptions = {}) {
  const today = todayLocal();
  const query = useExamModeQuery(examId, today);
  const applyPlan = useApplyCramPlan();
  const applyRetro = useApplyExamRetro();
  const queryClient = useQueryClient();
  // Both writes create or close tasks, so the task board is stale afterwards.
  const refreshTasks = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: taskKeys.all }),
    [queryClient],
  );

  const [outcome, setOutcome] = useState<ExamOutcome | null>(null);
  const [flagged, setFlagged] = useState<readonly string[]>([]);
  const [note, setNote] = useState('');

  const context = query.data ?? null;
  const topicIds = useMemo(() => (context?.topics ?? []).map((topic) => topic.id), [context]);
  const mistakes = useTopicMistakesFor(topicIds);
  const plan: CramPlan | null = useMemo(() => {
    if (!context) return null;
    return buildCramPlan({
      today,
      examDate: context.exam.examDate,
      topics: context.topics,
      capacityByWeekday,
    });
  }, [capacityByWeekday, context, today]);

  const days = context ? daysUntil(context.exam, today) : 0;

  const readiness: ReadinessRow[] = useMemo(() => {
    const byTopic = new Map<string, string[]>();
    for (const mistake of mistakes.data ?? []) {
      const current = byTopic.get(mistake.topicId) ?? [];
      if (current.length < MAX_SHOWN_MISTAKES) byTopic.set(mistake.topicId, [...current, mistakeLabel(mistake)]);
    }

    return (plan?.readiness ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      mastery: row.mastery,
      masteryLabel: MASTERY_LABEL[row.mastery],
      detail:
        row.steps.length === 0
          ? 'Hazır'
          : row.steps.length === 1
            ? '1 adım kaldı'
            : `${row.steps.length} adım kaldı`,
      // Before an exam, the thing worth reading is what went wrong last time.
      mistakes: byTopic.get(row.id) ?? [],
    }));
  }, [mistakes.data, plan]);

  const onCreateTasks = useCallback(() => {
    if (!context || !plan) return;
    const steps: CramTaskInput[] = plan.days.flatMap((day) =>
      day.items.map((item) => ({
        topic_id: item.topicId,
        type: item.type,
        title: item.title,
        instructions: item.instructions,
        target_count: item.step === 'quiz' ? 10 : null,
        estimated_minutes: item.estimatedMinutes,
        due_date: item.dueDate,
      })),
    );
    // A mixed set is a container with one step per topic: each topic's score
    // then reaches its own review schedule.
    const sets: CramTaskInput[] = plan.mixedSets.flatMap((set) => {
      const id = Crypto.randomUUID();
      const lead = set.parts[0];
      if (!lead) return [];
      return [
        {
          id,
          topic_id: lead.topicId,
          type: 'mock_exam' as const,
          title: set.title,
          instructions: set.instructions,
          target_count: null,
          estimated_minutes: set.estimatedMinutes,
          due_date: set.dueDate,
        },
        ...set.parts.map((part) => ({
          id: Crypto.randomUUID(),
          parent_id: id,
          topic_id: part.topicId,
          type: 'problem_set' as const,
          title: part.title,
          instructions: part.instructions,
          target_count: part.problems,
          estimated_minutes: part.minutes,
          due_date: set.dueDate,
        })),
      ];
    });
    const tasks = [...steps, ...sets];
    if (tasks.length === 0) {
      showToast('Eklenecek adım yok.', 'info');
      return;
    }
    applyPlan.mutate(
      { examId: context.exam.id, tasks },
      {
        onSuccess: (result) => {
          refreshTasks();
          const setCount = plan.mixedSets.length;
          showToast(
            `${result.inserted - result.steps} görev eklendi${setCount > 0 ? `; ${setCount} tanesi karışık tekrar seti` : ''}.`,
            'success',
          );
        },
        onError: (error) => showToast(describeError(error).title, 'danger'),
      },
    );
  }, [applyPlan, context, plan, refreshTasks]);

  const onToggleFlag = useCallback((topicId: string) => {
    setFlagged((current) =>
      current.includes(topicId) ? current.filter((id) => id !== topicId) : [...current, topicId],
    );
  }, []);

  const onSubmitRetro = useCallback(() => {
    if (!context || outcome === null) return;
    applyRetro.mutate(
      { examId: context.exam.id, outcome, note: note.trim() || null, flaggedTopicIds: flagged },
      {
        onSuccess: (result) => {
          refreshTasks();
          showToast(
            result.topicsUpdated > 0
              ? `${result.topicsUpdated} konunun tekrar planı güncellendi.`
              : 'Sınav kapatıldı.',
            'success',
          );
        },
        onError: (error) => showToast(describeError(error).title, 'danger'),
      },
    );
  }, [applyRetro, context, flagged, note, outcome, refreshTasks]);

  return {
    isLoading: query.isPending && context === null,
    error: context === null && query.isError ? describeError(query.error) : null,
    retry: () => void query.refetch(),
    header: context
      ? {
          title: context.exam.title,
          course: context.exam.course.code ?? context.exam.course.name,
          kindLabel: EXAM_KIND_LABEL[context.exam.kind],
          dateLabel: formatLongDate(context.exam.examDate),
          countdown:
            days > 0 ? `${days} gün kaldı` : days === 0 ? 'Sınav bugün' : `${Math.abs(days)} gün önceydi`,
          isUrgent: days >= 0 && days <= 3,
        }
      : null,
    /** Past exams show the retro instead of the sprint plan. */
    isPast: days < 0 || (days === 0 && context?.exam.reviewedAt !== null),
    isReviewed: context?.exam.reviewedAt != null,
    outOfWindow: days > CRAM_WINDOW_DAYS,
    windowDays: CRAM_WINDOW_DAYS,
    readiness,
    planDays: (plan?.days ?? []).map((day) => ({
      date: day.date,
      label: formatLongDate(day.date),
      minutes: day.minutes,
      items: day.items.map((item) => ({
        key: `${item.topicId}-${item.step}`,
        title: item.title,
        minutes: item.estimatedMinutes,
      })),
      sets: day.sets.map((set) => ({
        key: set.key,
        title: set.title,
        minutes: set.estimatedMinutes,
        legend: set.parts.map((part) => `${part.letter}: ${part.topicTitle} (${part.problems})`).join(' · '),
        sequence: set.sequence.join(' '),
      })),
    })),
    notes: plan?.notes ?? [],
    cramTasks: context?.cramTasks ?? { total: 0, open: 0 },
    isCreating: applyPlan.isPending,
    onCreateTasks,
    retro: {
      outcome,
      setOutcome,
      options: (Object.keys(EXAM_OUTCOME_LABEL) as unknown as string[]).map((value) => ({
        value: Number(value) as ExamOutcome,
        label: EXAM_OUTCOME_LABEL[Number(value) as ExamOutcome],
      })),
      flagged,
      onToggleFlag,
      note,
      setNote,
      topics: context?.topics ?? [],
      isSaving: applyRetro.isPending,
      canSubmit: outcome !== null && !applyRetro.isPending,
      onSubmit: onSubmitRetro,
    },
  };
}

export type ExamModeController = ReturnType<typeof useExamModeScreen>;
