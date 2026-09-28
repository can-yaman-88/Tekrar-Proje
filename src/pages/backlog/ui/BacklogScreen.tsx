import { BacklogScreenContent, useBacklogReview } from '@features/backlog';
import { useLearnedCapacity } from '@features/capacity';
import { Screen } from '@shared/ui';
import { useMemo } from 'react';

export function BacklogScreen() {
  const capacity = useLearnedCapacity();
  const capacityByWeekday = useMemo(
    () => Object.fromEntries(capacity.rows.map((row) => [row.weekday, row.minutes])),
    [capacity.rows],
  );

  return (
    <Screen edges={['bottom']}>
      <BacklogScreenContent backlog={useBacklogReview(capacityByWeekday)} />
    </Screen>
  );
}
