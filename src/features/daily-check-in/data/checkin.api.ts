import { DailyCheckinResponseSchema, type DailyCheckinResponse } from '@contracts/daily-checkin.contract';
import { invokeEdgeFunction } from '@shared/api/supabase';

export function processCheckin(dailyLogId: string): Promise<DailyCheckinResponse> {
  return invokeEdgeFunction('daily-checkin', { dailyLogId }, DailyCheckinResponseSchema);
}
