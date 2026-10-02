// POST /functions/v1/focus-timer — spoken by the Focus Timer Android app, not by Tekrar.
//
// The caller is identified by the pairing token in `x-timer-token`, never by a
// Supabase session: the timer holds no account credentials.
import { z } from 'zod';

/** One focus stretch as the timer recorded it. */
export const FocusSessionUpsertSchema = z.object({
  /** The timer's own id for the stretch; resending it updates instead of duplicating. */
  clientId: z.uuid(),
  courseId: z.uuid(),
  topicId: z.uuid().nullable(),
  kind: z.enum(['timer', 'stopwatch', 'manual']),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }),
  minutes: z.number().int().min(1).max(1440),
});
export type FocusSessionUpsert = z.infer<typeof FocusSessionUpsertSchema>;

export const FocusTimerRequestSchema = z.discriminatedUnion('action', [
  /** The courses and topics to choose from. */
  z.object({ action: z.literal('subjects') }),
  /** New or edited stretches, and the ids of stretches deleted on the phone. */
  z.object({
    action: z.literal('sync'),
    upserts: z.array(FocusSessionUpsertSchema).max(200).default([]),
    deletes: z.array(z.uuid()).max(200).default([]),
  }),
]);
export type FocusTimerRequest = z.infer<typeof FocusTimerRequestSchema>;

export interface FocusTimerSubjectsResponse {
  courses: {
    id: string;
    name: string;
    code: string | null;
    color: string | null;
    topics: { id: string; title: string; week: number | null }[];
  }[];
}

/** Why a stretch was refused; the timer stops retrying it. */
export type FocusSessionRejection = 'course_missing' | 'invalid_time';

export interface FocusTimerSyncResponse {
  /** Stored (or already stored): the timer marks these as sent. */
  accepted: string[];
  /** The topic was gone, so the time went to the course alone. */
  topicDropped: string[];
  rejected: { clientId: string; reason: FocusSessionRejection }[];
  deleted: string[];
}
