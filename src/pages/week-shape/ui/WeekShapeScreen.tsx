import { useLearnedCapacity } from '@features/capacity';
import { useWeekShape, WeekShapeContent } from '@features/week-shape';
import { todayLocal, weekStartOf } from '@shared/lib/date';
import { useMemo } from 'react';

/**
 * The week tidier lives on its own screen because it is a decision, not a
 * glance: it shows what would move and waits to be told to do it.
 */
export function WeekShapeScreen() {
  const capacity = useLearnedCapacity();
  const capacityByWeekday = useMemo(
    () => Object.fromEntries(capacity.rows.map((row) => [row.weekday, row.minutes])),
    [capacity.rows],
  );
  const weekStart = useMemo(() => weekStartOf(todayLocal()), []);

  return <WeekShapeContent shape={useWeekShape(weekStart, capacityByWeekday)} />;
}
