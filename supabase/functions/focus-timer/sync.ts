import type { FocusSessionRejection, FocusSessionUpsert } from '../_shared/contracts/focus-timer.contract.ts';

/** A row ready for `focus_sessions`, already checked against the student's own data. */
export interface FocusSessionRow {
  user_id: string;
  client_id: string;
  course_id: string;
  topic_id: string | null;
  task_id: string | null;
  kind: FocusSessionUpsert['kind'];
  started_at: string;
  ended_at: string;
  minutes: number;
}

/** Where a task lives: the stretch is filed under its topic and course. */
export interface TaskPlace {
  topicId: string;
  courseId: string;
}

export interface SortedUpserts {
  rows: FocusSessionRow[];
  topicDropped: string[];
  taskDropped: string[];
  rejected: { clientId: string; reason: FocusSessionRejection }[];
}

/** A clock a few minutes fast is normal; a stretch that ends tomorrow is not. */
const FUTURE_SLACK_MS = 10 * 60_000;

/**
 * Decides what happens to each stretch the timer sent, against the courses and
 * topics the student really has:
 *
 *  - a known task decides the topic and course, whatever the timer sent;
 *  - the task is gone → the time stays with the topic/course the timer sent;
 *  - the course is gone (deleted in Tekrar) → refused, the timer stops retrying;
 *  - the topic is gone or belongs to another course → kept under the course alone;
 *  - the times are impossible → refused.
 *
 * A clientId sent twice in one batch keeps its last version, as an edit would.
 */
export function sortUpserts(
  userId: string,
  upserts: readonly FocusSessionUpsert[],
  courseIds: ReadonlySet<string>,
  topicCourse: ReadonlyMap<string, string>,
  taskPlaces: ReadonlyMap<string, TaskPlace> = new Map(),
  now: Date = new Date(),
): SortedUpserts {
  const latest = new Map<string, FocusSessionUpsert>();
  for (const upsert of upserts) latest.set(upsert.clientId, upsert);

  const rows: FocusSessionRow[] = [];
  const topicDropped: string[] = [];
  const taskDropped: string[] = [];
  const rejected: SortedUpserts['rejected'] = [];

  for (const sent of latest.values()) {
    let upsert = sent;
    if (sent.taskId !== null) {
      const place = taskPlaces.get(sent.taskId);
      if (place) {
        upsert = { ...sent, courseId: place.courseId, topicId: place.topicId };
      } else {
        upsert = { ...sent, taskId: null };
        taskDropped.push(sent.clientId);
      }
    }

    // Placed by its task: topic and course come from the database, nothing to check.
    const placed = upsert.taskId !== null;

    if (!placed && !courseIds.has(upsert.courseId)) {
      rejected.push({ clientId: upsert.clientId, reason: 'course_missing' });
      continue;
    }
    const started = Date.parse(upsert.startedAt);
    const ended = Date.parse(upsert.endedAt);
    if (ended < started || ended > now.getTime() + FUTURE_SLACK_MS) {
      rejected.push({ clientId: upsert.clientId, reason: 'invalid_time' });
      continue;
    }

    let topicId = upsert.topicId;
    if (!placed && topicId !== null && topicCourse.get(topicId) !== upsert.courseId) {
      topicId = null;
      topicDropped.push(upsert.clientId);
    }

    rows.push({
      user_id: userId,
      client_id: upsert.clientId,
      course_id: upsert.courseId,
      topic_id: topicId,
      task_id: upsert.taskId,
      kind: upsert.kind,
      started_at: new Date(started).toISOString(),
      ended_at: new Date(ended).toISOString(),
      minutes: upsert.minutes,
    });
  }

  return { rows, topicDropped, taskDropped, rejected };
}

/** SHA-256 of the pairing token, as `issue_focus_timer_link` stores it. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
