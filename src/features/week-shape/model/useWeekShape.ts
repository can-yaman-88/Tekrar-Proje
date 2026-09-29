import type { IsoDate } from '@contracts/enums.contract';
import { isHomework, taskKeys, taskRepository, useWeekTasks, type Task } from '@entities/task';
import { isoWeekday } from '@domain/dates';
import { planWeekShape, studyStepOf, type ShapeDay, type ShapeTask, type WeekShapePlan } from '@domain/week-shape';
import { addDays, useToday } from '@shared/lib/date';
import { describeError } from '@shared/lib/errors';
import { showToast } from '@shared/lib/toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { buildShapePreview, type ShapePreviewModel } from './buildShapePreview';

/** Statuses that still describe work to be done. */
const OPEN: ReadonlySet<Task['status']> = new Set<Task['status']>(['pending', 'in_progress']);
const ASSUMED_TASK_MINUTES = 30;

/**
 * Tidying the week, on request.
 *
 * Everything here is deliberately manual: the plan is computed, shown, and
 * only applied when the student says so. A planner that rearranges the week
 * behind their back is a planner they stop trusting — and the one rule they
 * gave is that nothing moves without being seen first.
 */
export function useWeekShape(weekStart: IsoDate, capacityByWeekday: Readonly<Record<number, number>>) {
  const today = useToday();
  const queryClient = useQueryClient();
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const query = useWeekTasks(weekStart, weekEnd);
  const [applied, setApplied] = useState(false);

  const tasks = useMemo(() => query.data ?? [], [query.data]);

  const plan = useMemo<WeekShapePlan>(() => {
    // Past days are history and closed days are closed: neither can take work.
    const start = weekStart < today ? today : weekStart;
    const days: ShapeDay[] = [];
    for (let date = start; date <= weekEnd; date = addDays(date, 1)) {
      const capacity = capacityByWeekday[isoWeekday(date)] ?? 0;
      if (capacity <= 0) continue;
      days.push({ date, capacityMinutes: capacity, maxMainTasks: null });
    }

    const shapeTasks: ShapeTask[] = tasks.map((task) => ({
      id: task.id,
      topicId: task.topic.id,
      step: studyStepOf(task.type),
      dueDate: task.dueDate,
      estimatedMinutes: task.estimatedMinutes ?? ASSUMED_TASK_MINUTES,
      parentId: task.parentTaskId,
      hasDeadline: isHomework(task),
      isMovable: OPEN.has(task.status) && task.dueDate >= today,
    }));

    return planWeekShape({ today, days, tasks: shapeTasks, groupExistingPairs: true });
  }, [capacityByWeekday, tasks, today, weekEnd, weekStart]);

  const topicTitleById = useMemo(
    () => new Map(tasks.map((task) => [task.topic.id, task.topic.title])),
    [tasks],
  );

  const preview = useMemo<ShapePreviewModel>(
    () => buildShapePreview(plan, tasks, topicTitleById),
    [plan, tasks, topicTitleById],
  );

  const apply = useMutation({
    // Server-side work: offline this must fail loudly rather than queue.
    networkMode: 'always' as const,
    mutationFn: async () => {
      // Days first: a learning task is created on the day its steps end up on.
      const byDate = new Map<IsoDate, string[]>();
      for (const move of plan.moves) byDate.set(move.to, [...(byDate.get(move.to) ?? []), move.taskId]);
      for (const [date, taskIds] of byDate) await taskRepository.moveMany(taskIds, date);

      let grouped = 0;
      for (const pairing of plan.pairings) {
        try {
          await taskRepository.groupIntoLearningTask({
            childIds: [pairing.conceptTaskId, pairing.feynmanTaskId],
            title: `${topicTitleById.get(pairing.topicId) ?? 'Konu'} — öğrenme görevi`,
            dueDate: pairing.date,
          });
          grouped++;
        } catch {
          // One refused pair must not throw away the moves that already landed.
        }
      }

      return { moved: plan.moves.length, grouped };
    },
    onSuccess: async (result) => {
      setApplied(true);
      await queryClient.invalidateQueries({ queryKey: taskKeys.all });
      showToast(
        result.grouped > 0
          ? `${result.moved} görev taşındı, ${result.grouped} konu tek göreve toplandı.`
          : `${result.moved} görev taşındı.`,
        'success',
      );
    },
    onError: (error) => showToast(describeError(error).message, 'danger'),
  });

  const { refetch } = query;
  const refresh = useCallback(async () => {
    setApplied(false);
    await refetch();
  }, [refetch]);

  return {
    isLoading: query.isPending && query.data === undefined,
    error: query.data === undefined && query.isError ? describeError(query.error) : null,
    preview,
    /** True once this screen's plan has been applied; the list is then stale. */
    isApplied: applied,
    isApplying: apply.isPending,
    onApply: () => apply.mutate(),
    refresh,
  };
}

export type WeekShapeController = ReturnType<typeof useWeekShape>;
