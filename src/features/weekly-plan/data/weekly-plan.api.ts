import { WeeklyPlanResponseSchema, type WeeklyPlanResponse } from '@contracts/weekly-plan.contract';
import { invokeEdgeFunction } from '@shared/api/supabase';

export function generateWeeklyPlan(weekStart: string): Promise<WeeklyPlanResponse> {
  return invokeEdgeFunction('generate-weekly-plan', { weekStart }, WeeklyPlanResponseSchema);
}
