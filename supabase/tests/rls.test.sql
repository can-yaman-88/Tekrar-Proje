-- Row Level Security regression tests.
-- Run with: npx supabase test db
--
-- Proves the guarantees the schema is built on: one student can never read or
-- write another's data, anonymous callers get nothing, and the privileged RPCs
-- are unreachable from the app's role.
begin;
select plan(54);

create extension if not exists pgtap with schema extensions;

-- ---------------------------------------------------------------------------
-- Fixtures: two users, each with a course → topic → task chain.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'a@tekrar.test', 'x', now(), now(), now()),
  ('bbbbbbbb-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'b@tekrar.test', 'x', now(), now(), now());

insert into public.courses (id, user_id, name) values
  ('c0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001', 'A dersi'),
  ('c0000000-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000002', 'B dersi');

insert into public.topics (id, user_id, course_id, title) values
  ('d0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-00000000000a', 'A konu'),
  ('d0000000-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-00000000000b', 'B konu');

insert into public.tasks (id, user_id, topic_id, type, title, due_date) values
  ('e0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000a',
   'problem_set', 'A görevi', current_date),
  ('e0000000-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-00000000000b',
   'problem_set', 'B görevi', current_date);

insert into public.daily_logs (id, user_id, log_date, raw_text) values
  ('f0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001', current_date, 'A raporu');

-- ---------------------------------------------------------------------------
-- 1. Anonymous callers see nothing at all.
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok(
  'select count(*) from public.tasks',
  '42501',
  null,
  'anon cannot read tasks'
);
select throws_ok('select count(*) from public.courses', '42501', null, 'anon cannot read courses');
reset role;

-- ---------------------------------------------------------------------------
-- 2. User B sees only their own rows.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';

select is((select count(*) from public.tasks)::int, 1, 'B sees only their own task');
select is((select count(*) from public.courses)::int, 1, 'B sees only their own course');
select is((select count(*) from public.topics)::int, 1, 'B sees only their own topic');
select is((select count(*) from public.daily_logs)::int, 0, 'B cannot see A''s daily log');
select is(
  (select count(*) from public.tasks where id = 'e0000000-0000-4000-8000-00000000000a')::int,
  0,
  'B cannot read A''s task by id'
);

-- 3. B cannot modify or delete A's rows (RLS filters them out silently).
update public.tasks set title = 'ele geçirildi' where id = 'e0000000-0000-4000-8000-00000000000a';
select is((select count(*) from public.tasks where title = 'ele geçirildi')::int, 0, 'B cannot update A''s task');
delete from public.tasks where id = 'e0000000-0000-4000-8000-00000000000a';

-- 4. B cannot create rows owned by A, nor hang their own rows off A's parents.
select throws_ok(
  $$insert into public.courses (user_id, name) values ('aaaaaaaa-0000-4000-8000-000000000001', 'sahte')$$,
  '42501', null, 'B cannot insert a course owned by A'
);
select throws_ok(
  $$insert into public.topics (user_id, course_id, title)
    values ('bbbbbbbb-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-00000000000a', 'sızma')$$,
  '23503', null, 'B cannot attach a topic to A''s course'
);
select throws_ok(
  $$insert into public.tasks (user_id, topic_id, type, title, due_date)
    values ('bbbbbbbb-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-00000000000a', 'problem_set', 'sızma', current_date)$$,
  '23503', null, 'B cannot attach a task to A''s topic'
);

-- 5. Processing state is server-owned: the client may only create pending rows.
select throws_ok(
  $$insert into public.daily_logs (user_id, log_date, raw_text, status)
    values ('bbbbbbbb-0000-4000-8000-000000000002', current_date, 'hazır gibi', 'succeeded')$$,
  '42501', null, 'client cannot insert an already-processed daily log'
);
select lives_ok(
  $$insert into public.daily_logs (user_id, log_date, raw_text)
    values ('bbbbbbbb-0000-4000-8000-000000000002', current_date, 'normal rapor')$$,
  'client can insert a pending daily log'
);
-- There is no UPDATE policy on daily_logs, so the row is simply invisible to
-- the statement: no error, no change.
update public.daily_logs set status = 'succeeded' where user_id = 'bbbbbbbb-0000-4000-8000-000000000002';
select is(
  (select count(*) from public.daily_logs where status <> 'pending')::int,
  0,
  'client cannot mark its own log processed'
);

-- 6. The transactional RPCs are service-role only.
select throws_ok(
  $$select public.apply_daily_checkin('bbbbbbbb-0000-4000-8000-000000000002',
      'f0000000-0000-4000-8000-00000000000a', 'm', 's', '[]', '[]', '[]')$$,
  '42501', null, 'authenticated cannot call apply_daily_checkin'
);
select throws_ok(
  $$select public.apply_weekly_plan('bbbbbbbb-0000-4000-8000-000000000002', current_date, current_date, '[]')$$,
  '42501', null, 'authenticated cannot call apply_weekly_plan'
);
select throws_ok(
  $$select public.apply_syllabus_ingestion('bbbbbbbb-0000-4000-8000-000000000002',
      'f0000000-0000-4000-8000-00000000000a', 'm', '{}')$$,
  '42501', null, 'authenticated cannot call apply_syllabus_ingestion'
);

-- 7. Attachments follow their log's owner.
select is((select count(*) from public.daily_log_attachments)::int, 0, 'B sees no attachments of A');
select throws_ok(
  $$insert into public.daily_log_attachments (user_id, daily_log_id, storage_path, original_filename, mime_type, size_bytes)
    values ('bbbbbbbb-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-00000000000a',
            'bbbbbbbb-0000-4000-8000-000000000002/x.pdf', 'x.pdf', 'application/pdf', 100)$$,
  '23503', null, 'B cannot attach a file to A''s log'
);

-- 8. Otomatik plan tercihi: kullanıcı kendi satırını değiştirebilir, cron da buna uyar.
select is(
  (select auto_weekly_plan from public.profiles where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  true,
  'auto weekly plan is on by default'
);
update public.profiles set auto_weekly_plan = false where id = 'bbbbbbbb-0000-4000-8000-000000000002';
select is(
  (select auto_weekly_plan from public.profiles where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  false,
  'a student can switch the Monday run off'
);
reset role;
-- The cron function runs without RLS and selects `where auto_weekly_plan`:
-- B drops out of that set, A stays in it.
select is(
  (select count(*)::int from public.profiles
    where auto_weekly_plan and id in ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002')),
  1,
  'the cron job would now skip B and still pick A'
);

-- ---------------------------------------------------------------------------
-- 9. Study sessions belong to one student, and to one of their own tasks.
-- ---------------------------------------------------------------------------
insert into public.task_sessions (id, user_id, task_id, minutes, ended_at) values
  ('a1000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8000-00000000000a', 30, now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';

select is((select count(*) from public.task_sessions)::int, 0, 'B cannot see A''s study sessions');
select throws_ok(
  $$insert into public.task_sessions (user_id, task_id)
    values ('bbbbbbbb-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-00000000000a')$$,
  '23503',
  null,
  'B cannot time A''s task'
);

-- ---------------------------------------------------------------------------
-- 10. Exam mode: the RPCs act as the caller, never as the row''s owner.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.apply_exam_cram_plan('11111111-0000-4000-8000-00000000000a', '[]'::jsonb)$$,
  'P0002',
  null,
  'cram plan refuses an exam the caller does not own'
);
select throws_ok(
  $$select public.apply_exam_retro('11111111-0000-4000-8000-00000000000a', 3::smallint, null, '[]'::jsonb)$$,
  'P0002',
  null,
  'exam retro refuses an exam the caller does not own'
);
select throws_ok(
  $$select public.apply_exam_retro('11111111-0000-4000-8000-00000000000a', 9::smallint, null, '[]'::jsonb)$$,
  '22023',
  null,
  'exam retro rejects an out-of-range outcome'
);
reset role;

-- ---------------------------------------------------------------------------
-- 10b. Deleted-task snapshots are as private as the tasks they hold.
-- ---------------------------------------------------------------------------
insert into public.daily_log_task_deletions (user_id, daily_log_id, task_id, snapshot, reason)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-00000000000a',
        'e0000000-0000-4000-8000-00000000000a', '{"title":"A gizli görev"}'::jsonb, 'sil');

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*) from public.daily_log_task_deletions)::int,
  0,
  'B cannot see the tasks A deleted'
);
reset role;

-- ---------------------------------------------------------------------------
-- 10b2. Group tasks: one level deep, and never across users.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';

select throws_ok(
  $$insert into public.tasks (user_id, topic_id, type, title, due_date, parent_task_id)
    values ('bbbbbbbb-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-00000000000b',
            'problem_set', 'A''nın altına', current_date, 'e0000000-0000-4000-8000-00000000000a')$$,
  '23503',
  null,
  'B cannot hang a step off A''s task'
);
reset role;

-- One level: a step cannot itself have steps.
insert into public.tasks (id, user_id, topic_id, type, title, due_date, parent_task_id)
values ('e0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001',
        'd0000000-0000-4000-8000-00000000000a', 'problem_set', 'adım', current_date,
        'e0000000-0000-4000-8000-00000000000a');

select throws_ok(
  $$insert into public.tasks (user_id, topic_id, type, title, due_date, parent_task_id)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000a',
            'problem_set', 'torun', current_date, 'e0000000-0000-4000-8000-0000000000a1')$$,
  '23514',
  null,
  'a step cannot have steps of its own'
);

-- The parent follows its steps.
update public.tasks set status = 'completed', completed_at = now()
 where id = 'e0000000-0000-4000-8000-0000000000a1';
select is(
  (select status::text from public.tasks where id = 'e0000000-0000-4000-8000-00000000000a'),
  'completed',
  'a parent is completed when its only step is'
);

-- ---------------------------------------------------------------------------
-- 10b3. Removing a group never destroys work that hangs off it.
-- ---------------------------------------------------------------------------
insert into public.tasks (id, user_id, topic_id, type, title, due_date, source)
values ('e0000000-0000-4000-8000-0000000000c0', 'aaaaaaaa-0000-4000-8000-000000000001',
        'd0000000-0000-4000-8000-00000000000a', 'problem_set', 'grup ödevi', current_date, 'homework');
insert into public.tasks (id, user_id, topic_id, type, title, due_date, source, parent_task_id)
values
  ('e0000000-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-00000000000a', 'problem_set', 'çalışılmış adım', current_date, 'homework',
   'e0000000-0000-4000-8000-0000000000c0'),
  ('e0000000-0000-4000-8000-0000000000c2', 'aaaaaaaa-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-00000000000a', 'problem_set', 'temiz adım', current_date, 'homework',
   'e0000000-0000-4000-8000-0000000000c0');
insert into public.task_sessions (user_id, task_id, minutes, ended_at)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-0000000000c1', 25, now());

update public.daily_logs set status = 'processing' where id = 'f0000000-0000-4000-8000-00000000000a';
select lives_ok(
  $$select public.apply_daily_checkin('aaaaaaaa-0000-4000-8000-000000000001',
      'f0000000-0000-4000-8000-00000000000a', 'm', 's', '[]', '[]', '[]', '[]',
      jsonb_build_array(jsonb_build_object('task_id','e0000000-0000-4000-8000-0000000000c0','reason','sil')))$$,
  'removing a group runs'
);

select is(
  (select count(*)::int from public.tasks where id = 'e0000000-0000-4000-8000-0000000000c1'),
  1,
  'a step with measured study time survives its parent''s removal'
);
select is(
  (select status::text from public.tasks where id = 'e0000000-0000-4000-8000-0000000000c0'),
  'skipped',
  'a parent that shelters work is set aside, not deleted'
);

-- ---------------------------------------------------------------------------
-- 10b4. Accuracy is never invented.
-- ---------------------------------------------------------------------------
update public.daily_logs set status = 'processing' where id = 'f0000000-0000-4000-8000-00000000000a';
select lives_ok(
  $$select public.apply_daily_checkin('aaaaaaaa-0000-4000-8000-000000000001',
      'f0000000-0000-4000-8000-00000000000a', 'm', 's',
      jsonb_build_array(jsonb_build_object('task_id','e0000000-0000-4000-8000-00000000000a',
        'new_status','completed','confidence_level',4,'problems_solved',10,
        'completed_count',null,'correct_count',null,'note',null)),
      '[]', '[]', '[]', '[]')$$,
  'a report without an accuracy is applied'
);
select is(
  (select correct_count from public.tasks where id = 'e0000000-0000-4000-8000-00000000000a'),
  null,
  'no accuracy reported means no accuracy stored'
);

-- ---------------------------------------------------------------------------
-- 10c. The mistake book is as private as everything else, and the check-in
--      writer stays out of the app's reach.
-- ---------------------------------------------------------------------------
insert into public.topic_mistakes (user_id, topic_id, body)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000a', 'A''nın hatası');

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';

select is((select count(*) from public.topic_mistakes)::int, 0, 'B cannot read A''s mistake book');
select throws_ok(
  $$select public.apply_checkin_mistakes('bbbbbbbb-0000-4000-8000-000000000002',
      'f0000000-0000-4000-8000-00000000000a', '[]'::jsonb)$$,
  '42501',
  null,
  'authenticated cannot write the mistake book directly'
);
reset role;

-- ---------------------------------------------------------------------------
-- 11. The student's own provider key: one way in, never back out.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select public.set_llm_api_key('sk-or-v1-000011112222333344445555666677778888') ->> 'hint'),
  '8888',
  'storing a key returns only its last characters'
);
select is(
  (select llm_key_hint from public.profiles where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  '8888',
  'the profile keeps the hint, not the key'
);
select throws_ok(
  $$select public.read_llm_api_key('bbbbbbbb-0000-4000-8000-000000000002')$$,
  '42501',
  null,
  'the app cannot read a key back, not even its own'
);
select throws_ok(
  $$select public.set_llm_api_key('too-short')$$,
  '22023',
  null,
  'a value that is not a key is refused'
);

reset role;

-- The server side: it can read B''s key to make B''s calls, and B''s key is
-- B''s alone — A still has none.
set local role service_role;
select is(
  public.read_llm_api_key('bbbbbbbb-0000-4000-8000-000000000002'),
  'sk-or-v1-000011112222333344445555666677778888',
  'the server can read the key it will pay with'
);
select is(
  public.read_llm_api_key('aaaaaaaa-0000-4000-8000-000000000001'),
  null,
  'storing B''s key left A without one'
);
reset role;

-- Clearing it puts the student back on the deployment's key.
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select public.clear_llm_api_key();
select is(
  (select llm_key_hint from public.profiles where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  null,
  'clearing the key clears its fingerprint too'
);
reset role;

-- ---------------------------------------------------------------------------
-- 12. Closed weekdays and deleting a check-in.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

update public.profiles set blocked_weekdays = '{7}' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select is(
  (select blocked_weekdays from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  '{7}'::smallint[],
  'a student can close one of their own weekdays'
);
select throws_ok(
  $$update public.profiles set blocked_weekdays = '{1,2,3,4,5,6,7}'
     where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'the whole week cannot be closed'
);
select is(
  (select count(*)::int from public.profiles
    where id = 'bbbbbbbb-0000-4000-8000-000000000002' and blocked_weekdays = '{7}'),
  0,
  'closing A''s Sunday left B''s week alone'
);

-- B may not delete A's check-in, and cannot even see that it exists.
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$select public.delete_daily_checkin('f0000000-0000-4000-8000-00000000000a', false)$$,
  'P0002',
  null,
  'B cannot delete A''s check-in'
);
select is(
  (select count(*)::int from public.daily_logs where id = 'f0000000-0000-4000-8000-00000000000a'),
  0,
  'and B cannot see it either'
);

-- A deletes their own, which is theirs to delete.
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select public.delete_daily_checkin('f0000000-0000-4000-8000-00000000000a', false);
select is(
  (select count(*)::int from public.daily_logs where id = 'f0000000-0000-4000-8000-00000000000a'),
  0,
  'A''s own check-in record is gone'
);
reset role;

-- ---------------------------------------------------------------------------
-- The check-in's wider authority: its audit trail is as private as the rest,
-- and only the server may exercise it.
-- ---------------------------------------------------------------------------
insert into public.daily_logs (id, user_id, log_date, raw_text, status)
values ('f0000000-0000-4000-8000-00000000000e', 'aaaaaaaa-0000-4000-8000-000000000001',
        current_date, 'A yetki raporu', 'succeeded');

insert into public.daily_log_exam_changes (user_id, daily_log_id, exam_id, action, previous)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-00000000000e',
        'e0000000-0000-4000-8000-00000000000a', 'update', '{"title": "A vizesi"}'::jsonb);

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.daily_log_exam_changes),
  0,
  'B cannot see what A''s check-in did to A''s exams'
);
-- Giving the report the student's own powers must not give them to the client:
-- the edits only ever run from the Edge Function, under the service role.
select throws_ok(
  $$select public.apply_checkin_edits(
      'bbbbbbbb-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-00000000000e',
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)$$,
  '42501',
  null,
  'a signed-in client cannot run the check-in edit RPC'
);

set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.daily_log_exam_changes),
  1,
  'A sees their own exam history'
);
reset role;

select * from finish();
rollback;
