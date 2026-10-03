// POST /functions/v1/focus-timer — spoken by the Focus Timer Android app, not by Tekrar.
//
// The caller is identified by the pairing token in `x-timer-token`, never by a
// Supabase session: the timer holds no account credentials. The one exception
// is `claim`, which trades a pairing code from Tekrar's Settings for a token.
import { z } from 'zod';

/**
 * Which install of the timer is calling. A device that pairs again replaces
 * only its own older pairing, so the student can keep the timer on several
 * devices. The name is what Settings lists.
 */
export const TimerDeviceSchema = z.object({
  id: z.uuid(),
  name: z
    .string()
    .max(200)
    .nullable()
    .default(null)
    .transform((name) => name?.trim().slice(0, 60) || null),
});
export type TimerDevice = z.infer<typeof TimerDeviceSchema>;

/** Timers from before devices send none. */
const OptionalDevice = TimerDeviceSchema.optional();

/** One focus stretch as the timer recorded it. */
export const FocusSessionUpsertSchema = z.object({
  /** The timer's own id for the stretch; resending it updates instead of duplicating. */
  clientId: z.uuid(),
  courseId: z.uuid(),
  topicId: z.uuid().nullable(),
  /**
   * The task the time went into. When set, the server files the stretch under
   * the task's own topic and course, whatever the timer sent for those.
   * Optional so a timer from before tasks still syncs.
   */
  taskId: z.uuid().nullable().default(null),
  kind: z.enum(['timer', 'stopwatch', 'manual']),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }),
  minutes: z.number().int().min(1).max(1440),
});
export type FocusSessionUpsert = z.infer<typeof FocusSessionUpsertSchema>;

export const FocusTimerRequestSchema = z.discriminatedUnion('action', [
  /** The courses and topics to choose from. */
  z.object({ action: z.literal('subjects'), device: OptionalDevice }),
  /** New or edited stretches, and the ids of stretches deleted on the phone. */
  z.object({
    action: z.literal('sync'),
    upserts: z.array(FocusSessionUpsertSchema).max(200).default([]),
    deletes: z.array(z.uuid()).max(200).default([]),
    device: OptionalDevice,
  }),
  /** A pairing code typed into the timer; answered with the device's own token. No `x-timer-token`. */
  z.object({ action: z.literal('claim'), code: z.string().max(32), device: TimerDeviceSchema }),
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
  /**
   * Open work the time can be filed under: single tasks and the steps of group
   * tasks (a group is only a container — its steps carry the minutes). Due
   * from a few weeks back (still open = overdue) to a few weeks ahead.
   */
  tasks: {
    id: string;
    topicId: string;
    title: string;
    /** The group task a step belongs to, for context ("Kafes sistemler öğrenme › Feynman"). */
    parentTitle: string | null;
    type: string;
    dueDate: string;
    estimatedMinutes: number | null;
    /** Minutes already measured on it, from both clocks. */
    measuredMinutes: number;
  }[];
}

/** Why a stretch was refused; the timer stops retrying it. */
export type FocusSessionRejection = 'course_missing' | 'invalid_time';

export interface FocusTimerSyncResponse {
  /** Stored (or already stored): the timer marks these as sent. */
  accepted: string[];
  /** The topic was gone, so the time went to the course alone. */
  topicDropped: string[];
  /** The task was gone, so the time went to its topic (or course) instead. */
  taskDropped: string[];
  rejected: { clientId: string; reason: FocusSessionRejection }[];
  deleted: string[];
}

export interface FocusTimerClaimResponse {
  /** This device's pairing token, sent as `x-timer-token` from now on. */
  token: string;
  /** The account the device is now paired with, to show on the timer. */
  account: string | null;
}
