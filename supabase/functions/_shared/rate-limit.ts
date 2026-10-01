import { HttpError } from './errors.ts';
import type { TypedClient } from './supabase.ts';

/** How often each LLM-backed action may run per student. Generous for a person, tight for a loop. */
export const RATE_LIMITS = {
  checkin: { limit: 20, windowSeconds: 3600, message: 'Bir saatte en fazla 20 değerlendirme işlenebilir. Biraz sonra tekrar dene.' },
  syllabus: { limit: 10, windowSeconds: 3600, message: 'Bir saatte en fazla 10 izlence işlenebilir. Biraz sonra tekrar dene.' },
  weekly_plan: { limit: 10, windowSeconds: 3600, message: 'Haftalık planı bir saatte en fazla 10 kez oluşturabilirsin.' },
  llm_models: { limit: 30, windowSeconds: 3600, message: 'Model listesi çok sık istendi. Biraz sonra tekrar dene.' },
  llm_test: { limit: 10, windowSeconds: 3600, message: 'Bir saatte en fazla 10 model denemesi yapılabilir.' },
} as const;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

/**
 * Counts this call against the student's allowance and refuses it once the
 * window is full. Fails open: if the counter itself cannot be reached, the
 * student is not punished for the server's trouble — the call goes through
 * and the failure is logged.
 */
export async function enforceRateLimit(service: TypedClient, userId: string, bucket: RateLimitBucket): Promise<void> {
  const rule = RATE_LIMITS[bucket];
  const { data, error } = await service.rpc('hit_rate_limit', {
    p_user_id: userId,
    p_bucket: bucket,
    p_limit: rule.limit,
    p_window_seconds: rule.windowSeconds,
  });
  if (error) {
    console.warn(JSON.stringify({ event: 'rate_limit_unavailable', bucket, message: error.message }));
    return;
  }
  if (data === false) throw new HttpError('rate_limited', rule.message);
}
