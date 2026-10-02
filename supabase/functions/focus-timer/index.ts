// POST /functions/v1/focus-timer — called by the Focus Timer Android app.
//   { action: "subjects" }                     → courses and their topics, to pick from
//   { action: "sync", upserts, deletes }       → focus stretches recorded on the phone
//
// The timer holds no Supabase session. It authenticates with the pairing token
// Tekrar handed it (header `x-timer-token`), so this function runs with
// verify_jwt = false and does its own check: the token's hash must belong to a
// pairing that has not been revoked. Everything after that is scoped to the
// pairing's user, with the service role.
import {
  FocusTimerRequestSchema,
  type FocusTimerSubjectsResponse,
  type FocusTimerSyncResponse,
} from '../_shared/contracts/focus-timer.contract.ts';
import { getEnv } from '../_shared/env.ts';
import { HttpError } from '../_shared/errors.ts';
import { createHandler, jsonResponse, readJson } from '../_shared/http.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { createServiceClient, type TypedClient } from '../_shared/supabase.ts';
import { addDaysUtc, buildTaskList, sumByTask, TASK_WINDOW } from './subjects.ts';
import { hashToken, sortUpserts, type TaskPlace } from './sync.ts';

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const UNLINKED_MESSAGE = 'Bu bağlantı artık geçerli değil. Tekrar → Ayarlar → Focus Timer’dan yeniden bağla.';

interface Link {
  id: string;
  userId: string;
  createdAt: string;
}

async function authenticateLink(req: Request, service: TypedClient): Promise<Link> {
  const token = req.headers.get('x-timer-token')?.trim() ?? '';
  if (!TOKEN_PATTERN.test(token)) throw new HttpError('unauthorized', UNLINKED_MESSAGE);

  const { data, error } = await service
    .from('focus_timer_links')
    .select('id, user_id, created_at')
    .eq('token_hash', await hashToken(token))
    .is('revoked_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError('unauthorized', UNLINKED_MESSAGE);
  return { id: data.id, userId: data.user_id, createdAt: data.created_at };
}

/**
 * Marks the pairing as alive and retires any older one: the first request
 * with a new token is what makes a re-pairing final.
 */
async function touchLink(service: TypedClient, link: Link): Promise<void> {
  const now = new Date().toISOString();
  const [touched, retired] = await Promise.all([
    service.from('focus_timer_links').update({ last_used_at: now }).eq('id', link.id),
    service
      .from('focus_timer_links')
      .update({ revoked_at: now })
      .eq('user_id', link.userId)
      .is('revoked_at', null)
      .lt('created_at', link.createdAt),
  ]);
  if (touched.error) throw touched.error;
  if (retired.error) throw retired.error;
}

async function loadSubjects(service: TypedClient, userId: string): Promise<FocusTimerSubjectsResponse> {
  const today = new Date().toISOString().slice(0, 10);
  const from = addDaysUtc(today, -TASK_WINDOW.pastDays);
  const to = addDaysUtc(today, TASK_WINDOW.futureDays);
  // Minutes on these tasks are recent; a quarter of a year covers them comfortably.
  const measuredSince = `${addDaysUtc(from, -60)}T00:00:00Z`;

  const [courses, topics, openTasks, steps, taskClock, timerClock] = await Promise.all([
    service.from('courses').select('id, name, code, color_hex').eq('user_id', userId).order('name'),
    service
      .from('topics')
      .select('id, course_id, title, week_number, position')
      .eq('user_id', userId)
      .order('week_number', { ascending: true, nullsFirst: false })
      .order('position', { ascending: true }),
    service
      .from('tasks')
      .select('id, topic_id, parent_task_id, title, type, due_date, estimated_minutes')
      .eq('user_id', userId)
      .in('status', ['pending', 'in_progress'])
      .gte('due_date', from)
      .lte('due_date', to)
      .order('due_date', { ascending: true })
      .limit(500),
    // Which tasks are containers: anything that is some step's parent.
    service
      .from('tasks')
      .select('parent_task_id')
      .eq('user_id', userId)
      .not('parent_task_id', 'is', null)
      .gte('due_date', addDaysUtc(from, -30)),
    service
      .from('task_sessions')
      .select('task_id, minutes')
      .eq('user_id', userId)
      .gte('started_at', measuredSince)
      .not('minutes', 'is', null),
    service
      .from('focus_sessions')
      .select('task_id, minutes')
      .eq('user_id', userId)
      .gte('started_at', measuredSince)
      .not('task_id', 'is', null),
  ]);
  if (courses.error) throw courses.error;
  if (topics.error) throw topics.error;
  if (openTasks.error) throw openTasks.error;
  if (steps.error) throw steps.error;
  if (taskClock.error) throw taskClock.error;
  if (timerClock.error) throw timerClock.error;

  const containerIds = new Set(steps.data.flatMap((row) => (row.parent_task_id ? [row.parent_task_id] : [])));
  const parentIds = [
    ...new Set(openTasks.data.flatMap((task) => (task.parent_task_id ? [task.parent_task_id] : []))),
  ];
  const parents =
    parentIds.length === 0
      ? { data: [] as { id: string; title: string }[], error: null }
      : await service.from('tasks').select('id, title').eq('user_id', userId).in('id', parentIds);
  if (parents.error) throw parents.error;

  return {
    courses: courses.data.map((course) => ({
      id: course.id,
      name: course.name,
      code: course.code,
      color: course.color_hex,
      topics: topics.data
        .filter((topic) => topic.course_id === course.id)
        .map((topic) => ({ id: topic.id, title: topic.title, week: topic.week_number })),
    })),
    tasks: buildTaskList(
      openTasks.data,
      containerIds,
      new Map(parents.data.map((parent) => [parent.id, parent.title])),
      sumByTask([...taskClock.data, ...timerClock.data]),
    ),
  };
}

async function sync(
  service: TypedClient,
  userId: string,
  upserts: Parameters<typeof sortUpserts>[1],
  deletes: readonly string[],
): Promise<FocusTimerSyncResponse> {
  if (deletes.length > 0) {
    const { error } = await service
      .from('focus_sessions')
      .delete()
      .eq('user_id', userId)
      .in('client_id', [...deletes]);
    if (error) throw error;
  }

  if (upserts.length === 0) {
    return { accepted: [], topicDropped: [], taskDropped: [], rejected: [], deleted: [...deletes] };
  }

  const courseIds = [...new Set(upserts.map((upsert) => upsert.courseId))];
  const topicIds = [...new Set(upserts.flatMap((upsert) => (upsert.topicId ? [upsert.topicId] : [])))];
  const taskIds = [...new Set(upserts.flatMap((upsert) => (upsert.taskId ? [upsert.taskId] : [])))];
  const [courses, topics, tasks] = await Promise.all([
    service.from('courses').select('id').eq('user_id', userId).in('id', courseIds),
    topicIds.length === 0
      ? Promise.resolve({ data: [] as { id: string; course_id: string }[], error: null })
      : service.from('topics').select('id, course_id').eq('user_id', userId).in('id', topicIds),
    taskIds.length === 0
      ? Promise.resolve({ data: [] as { id: string; topic_id: string; topic: { course_id: string } | null }[], error: null })
      : service
          .from('tasks')
          .select('id, topic_id, topic:topics!tasks_topic_fk(course_id)')
          .eq('user_id', userId)
          .in('id', taskIds),
  ]);
  if (courses.error) throw courses.error;
  if (topics.error) throw topics.error;
  if (tasks.error) throw tasks.error;

  const taskPlaces = new Map<string, TaskPlace>(
    tasks.data.flatMap((task) =>
      task.topic ? [[task.id, { topicId: task.topic_id, courseId: task.topic.course_id }] as const] : [],
    ),
  );

  const sorted = sortUpserts(
    userId,
    upserts,
    new Set(courses.data.map((course) => course.id)),
    new Map(topics.data.map((topic) => [topic.id, topic.course_id])),
    taskPlaces,
  );

  if (sorted.rows.length > 0) {
    const { error } = await service.from('focus_sessions').upsert(sorted.rows, { onConflict: 'user_id,client_id' });
    if (error) throw error;
  }

  return {
    accepted: sorted.rows.map((row) => row.client_id),
    topicDropped: sorted.topicDropped,
    taskDropped: sorted.taskDropped,
    rejected: sorted.rejected,
    deleted: [...deletes],
  };
}

Deno.serve(
  createHandler('focus-timer', async (req, { log, identify }) => {
    const service = createServiceClient(getEnv());
    const link = await authenticateLink(req, service);
    identify(link.userId);
    const body = FocusTimerRequestSchema.parse(await readJson(req));
    await enforceRateLimit(service, link.userId, 'focus_timer');
    await touchLink(service, link);

    if (body.action === 'subjects') return jsonResponse(await loadSubjects(service, link.userId));

    const result = await sync(service, link.userId, body.upserts, body.deletes);
    log.info('focus_sync', {
      accepted: result.accepted.length,
      rejected: result.rejected.length,
      deleted: result.deleted.length,
    });
    return jsonResponse(result);
  }),
);
