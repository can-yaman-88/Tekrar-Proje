import type { Task } from '@entities/task';
import { useLearnedCapacity } from '@features/capacity';
import { AllocationCard, useTaskAllocation } from '@features/task-allocation';

/**
 * Mounted only for homework that still has days ahead of it — the hook below
 * runs queries and math that mean nothing for an ordinary loop task.
 */
export function TaskAllocationSection({ task }: { task: Task }) {
  // The same per-day budget the weekly planner fills, class hours included.
  const { budgetByWeekday } = useLearnedCapacity();
  const allocation = useTaskAllocation(task, budgetByWeekday);

  return <AllocationCard allocation={allocation} />;
}
