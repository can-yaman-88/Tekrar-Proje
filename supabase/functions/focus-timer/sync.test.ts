import { assertEquals } from 'jsr:@std/assert@1';
import type { FocusSessionUpsert } from '../_shared/contracts/focus-timer.contract.ts';
import { hashToken, sortUpserts } from './sync.ts';

const USER = 'aaaaaaaa-0000-4000-8000-000000000001';
const COURSE = 'c0000000-0000-4000-8000-00000000000a';
const OTHER_COURSE = 'c0000000-0000-4000-8000-00000000000b';
const TOPIC = 'd0000000-0000-4000-8000-00000000000a';
const NOW = new Date('2026-10-02T12:00:00Z');

const upsert = (clientId: string, patch: Partial<FocusSessionUpsert> = {}): FocusSessionUpsert => ({
  clientId,
  courseId: COURSE,
  topicId: TOPIC,
  kind: 'timer',
  startedAt: '2026-10-02T09:00:00+03:00',
  endedAt: '2026-10-02T09:50:00+03:00',
  minutes: 50,
  ...patch,
});

const courses = new Set([COURSE, OTHER_COURSE]);
const topics = new Map([[TOPIC, COURSE]]);

Deno.test('a stretch on a known course and topic is stored as sent, in UTC', () => {
  const result = sortUpserts(USER, [upsert('11111111-0000-4000-8000-000000000001')], courses, topics, NOW);
  assertEquals(result.rejected, []);
  assertEquals(result.topicDropped, []);
  assertEquals(result.rows, [
    {
      user_id: USER,
      client_id: '11111111-0000-4000-8000-000000000001',
      course_id: COURSE,
      topic_id: TOPIC,
      kind: 'timer',
      started_at: '2026-10-02T06:00:00.000Z',
      ended_at: '2026-10-02T06:50:00.000Z',
      minutes: 50,
    },
  ]);
});

Deno.test('a deleted course refuses the stretch', () => {
  const result = sortUpserts(
    USER,
    [upsert('11111111-0000-4000-8000-000000000002', { courseId: 'c0000000-0000-4000-8000-0000000000ff' })],
    courses,
    topics,
    NOW,
  );
  assertEquals(result.rows, []);
  assertEquals(result.rejected, [{ clientId: '11111111-0000-4000-8000-000000000002', reason: 'course_missing' }]);
});

Deno.test('a topic that is gone or belongs elsewhere leaves the time with the course', () => {
  const result = sortUpserts(
    USER,
    [
      upsert('11111111-0000-4000-8000-000000000003', { topicId: 'd0000000-0000-4000-8000-0000000000ff' }),
      upsert('11111111-0000-4000-8000-000000000004', { courseId: OTHER_COURSE }),
    ],
    courses,
    topics,
    NOW,
  );
  assertEquals(result.rows.map((row) => row.topic_id), [null, null]);
  assertEquals(result.topicDropped, ['11111111-0000-4000-8000-000000000003', '11111111-0000-4000-8000-000000000004']);
});

Deno.test('impossible times are refused', () => {
  const result = sortUpserts(
    USER,
    [
      upsert('11111111-0000-4000-8000-000000000005', { endedAt: '2026-10-02T08:00:00+03:00' }),
      upsert('11111111-0000-4000-8000-000000000006', { endedAt: '2026-10-03T09:00:00+03:00' }),
    ],
    courses,
    topics,
    NOW,
  );
  assertEquals(result.rows, []);
  assertEquals(
    result.rejected.map((entry) => entry.reason),
    ['invalid_time', 'invalid_time'],
  );
});

Deno.test('the same stretch twice in one batch keeps the later version', () => {
  const result = sortUpserts(
    USER,
    [upsert('11111111-0000-4000-8000-000000000007'), upsert('11111111-0000-4000-8000-000000000007', { minutes: 30 })],
    courses,
    topics,
    NOW,
  );
  assertEquals(result.rows.length, 1);
  assertEquals(result.rows[0]?.minutes, 30);
});

Deno.test('the token hash matches what Postgres stores', async () => {
  // select encode(sha256(convert_to('abc', 'UTF8')), 'hex')
  assertEquals(await hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
