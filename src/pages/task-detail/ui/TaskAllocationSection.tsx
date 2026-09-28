import type { Task } from '@entities/task';
import { useLearnedCapacity } from '@features/capacity';
import { AllocationCard, useTaskAllocation } from '@features/task-allocation';
import { useMemo } from 'react';

/**
 * Mounted only for homework that still has days ahead of it — the hook below
 * runs queries and math that mean nothing for an ordinary loop task.
 */
export function TaskAllocationSection({ task }: { task: Task }) {
  const capacity = useLearnedCapacity();
  const capacityByWeekday = useMemo(
    () => Object.fromEntries(capacity.rows.map((row) => [row.weekday, row.minutes])),
    [capacity.rows],
  );
  const allocation = useTaskAllocation(task, capacityByWeekday);

  return <AllocationCard allocation={allocation} />;
}
