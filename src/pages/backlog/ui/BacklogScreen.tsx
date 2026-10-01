import { BacklogScreenContent, useBacklogReview } from '@features/backlog';
import { useLearnedCapacity } from '@features/capacity';
import { Screen } from '@shared/ui';

export function BacklogScreen() {
  // The same per-day budget the weekly planner fills, class hours included.
  const { budgetByWeekday } = useLearnedCapacity();

  return (
    <Screen edges={['bottom']}>
      <BacklogScreenContent backlog={useBacklogReview(budgetByWeekday)} />
    </Screen>
  );
}
