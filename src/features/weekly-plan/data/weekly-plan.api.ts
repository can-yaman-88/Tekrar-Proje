import { WeeklyPlanResponseSchema, type WeeklyPlanResponse } from '@contracts/weekly-plan.contract';
import { invokeEdgeFunction } from '@shared/api/supabase';

/** `today` is the phone's own date: the plan starts there, never on a day already behind. */
export function generateWeeklyPlan(weekStart: string, today: string): Promise<WeeklyPlanResponse> {
  return invokeEdgeFunction('generate-weekly-plan', { weekStart, today }, WeeklyPlanResponseSchema);
}
