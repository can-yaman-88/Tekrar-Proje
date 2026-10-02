-- Row Level Security regression tests.
-- Run with: npx supabase test db
--
-- Proves the guarantees the schema is built on: one student can never read or
-- write another's data, anonymous callers get nothing, and the privileged RPCs
-- are unreachable from the app's role.
begin;
select plan(166);

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
  $$select public.apply_exam_retro('11111111-0000-4000-8000-00000000000a', 3::smallint, null, '{}'::uuid[])$$,
  'P0002',
  null,
  'exam retro refuses an exam the caller does not own'
);
select throws_ok(
  $$select public.apply_exam_retro('11111111-0000-4000-8000-00000000000a', 9::smallint, null, '{}'::uuid[])$$,
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

insert into public.daily_log_extras (user_id, daily_log_id, kind, target_id, previous)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-00000000000e',
        'exam_result', 'e0000000-0000-4000-8000-00000000000a', '{"outcome": null}'::jsonb);

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
select throws_ok(
  $$select public.apply_checkin_reopen_weekdays(
      'bbbbbbbb-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-00000000000e', '[7]'::jsonb)$$,
  '42501',
  null,
  'a signed-in client cannot reopen weekdays through the check-in RPC'
);
select throws_ok(
  $$select public.apply_checkin_extras(
      'bbbbbbbb-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-00000000000e')$$,
  '42501',
  null,
  'a signed-in client cannot write off-plan work, exam results or urgency through the check-in RPC'
);
select throws_ok(
  $$select public.apply_checkin_ungroup('bbbbbbbb-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-00000000000e')$$,
  '42501',
  null,
  'a signed-in client cannot take groups apart through the check-in RPC'
);
select throws_ok(
  $$select public.apply_checkin_exam_scopes('bbbbbbbb-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-00000000000e')$$,
  '42501',
  null,
  'a signed-in client cannot set exam topics through the check-in RPC'
);
select throws_ok(
  $$select public.ungroup_task('e0000000-0000-4000-8000-00000000000a')$$,
  'P0002',
  null,
  'B cannot take A''s group apart by hand'
);
select is(
  (select count(*)::int from public.daily_log_extras),
  0,
  'B cannot see what A''s check-in recorded as extras'
);

set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.daily_log_exam_changes),
  1,
  'A sees their own exam history'
);
select is(
  (select count(*)::int from public.daily_log_extras),
  1,
  'A sees their own check-in extras'
);
reset role;

-- ---------------------------------------------------------------------------
-- 13. Learning tasks: the weekly plan replaces groups whole, or not at all.
-- ---------------------------------------------------------------------------
set local role service_role;

-- A plan with one learning task and its two steps.
select public.apply_weekly_plan(
  'aaaaaaaa-0000-4000-8000-000000000001',
  current_date,
  current_date + 6,
  json_build_array(
    json_build_object('id', '11110000-0000-4000-8000-00000000000a', 'parent_task_id', null,
      'topic_id', 'd0000000-0000-4000-8000-00000000000a', 'type', 'learning',
      'title', 'Öğrenme görevi', 'instructions', '-', 'target_count', null,
      'estimated_minutes', null, 'due_date', current_date + 1),
    json_build_object('id', '11110000-0000-4000-8000-00000000000b',
      'parent_task_id', '11110000-0000-4000-8000-00000000000a',
      'topic_id', 'd0000000-0000-4000-8000-00000000000a', 'type', 'concept_note',
      'title', 'Konsept', 'instructions', '-', 'target_count', null,
      'estimated_minutes', 30, 'due_date', current_date + 1),
    json_build_object('id', '11110000-0000-4000-8000-00000000000c',
      'parent_task_id', '11110000-0000-4000-8000-00000000000a',
      'topic_id', 'd0000000-0000-4000-8000-00000000000a', 'type', 'feynman',
      'title', 'Feynman', 'instructions', '-', 'target_count', null,
      'estimated_minutes', 25, 'due_date', current_date + 1)
  )::jsonb
);

select is(
  (select count(*)::int from public.tasks
    where parent_task_id = '11110000-0000-4000-8000-00000000000a'),
  2,
  'the weekly plan can write a learning task with two steps'
);
select is(
  (select estimated_minutes from public.tasks where id = '11110000-0000-4000-8000-00000000000a'),
  null,
  'the container carries no minutes of its own'
);

-- A note on one step: the whole group is work now, and must survive re-planning.
insert into public.task_notes (user_id, task_id, body)
values ('aaaaaaaa-0000-4000-8000-000000000001', '11110000-0000-4000-8000-00000000000b', 'hocanın tablosu');

select is(
  (public.apply_weekly_plan('aaaaaaaa-0000-4000-8000-000000000001', current_date, current_date + 6,
     '[]'::jsonb) ->> 'deleted')::int,
  0,
  'a step carrying a note keeps its whole group through a re-plan'
);
select is(
  (select count(*)::int from public.tasks
    where id in ('11110000-0000-4000-8000-00000000000a', '11110000-0000-4000-8000-00000000000b',
                 '11110000-0000-4000-8000-00000000000c')),
  3,
  'and the cascade destroys nothing'
);

-- With the note gone the group is untouched work again, and goes as one.
delete from public.task_notes where task_id = '11110000-0000-4000-8000-00000000000b';
select is(
  (public.apply_weekly_plan('aaaaaaaa-0000-4000-8000-000000000001', current_date, current_date + 6,
     '[]'::jsonb) ->> 'deleted')::int,
  3,
  'an untouched group is replaced whole'
);
reset role;

-- ---------------------------------------------------------------------------
-- 14. Gathering existing tasks into a learning task.
-- ---------------------------------------------------------------------------
insert into public.tasks (id, user_id, topic_id, type, title, due_date) values
  ('22220000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-00000000000a', 'concept_note', 'A konsept', current_date),
  ('22220000-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-00000000000a', 'feynman', 'A Feynman', current_date);

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

-- Called on its own: a volatile function inside a WHERE clause would run once
-- per scanned row, and the second run would find the pair already grouped.
select public.group_learning_pair(
  array['22220000-0000-4000-8000-00000000000a', '22220000-0000-4000-8000-00000000000b']::uuid[],
  'Kafes — öğrenme görevi', current_date
);

select is(
  (select count(*)::int from public.tasks
    where id in ('22220000-0000-4000-8000-00000000000a', '22220000-0000-4000-8000-00000000000b')
      and parent_task_id is not null),
  2,
  'two loose tasks become the steps of one learning task'
);
select is(
  (select t.type::text from public.tasks t
    where t.id = (select parent_task_id from public.tasks
                   where id = '22220000-0000-4000-8000-00000000000a')),
  'learning',
  'the task they were gathered under is a learning task'
);

-- B''s task is not A''s to gather, and the refusal is explicit rather than silent.
select throws_ok(
  $$select public.group_learning_pair(
      array['e0000000-0000-4000-8000-00000000000b']::uuid[], 'Olmaz', current_date)$$,
  '23514',
  null,
  'grouping refuses a single task, and never sees another user''s'
);
reset role;

-- ---------------------------------------------------------------------------
-- 15. The review cycle: ticking work off moves the schedule, the history is
--     the student's alone and read-only, and nothing is counted twice.
-- ---------------------------------------------------------------------------
insert into public.topics (id, user_id, course_id, title) values
  ('d0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-00000000000a', 'A tekrar konusu');
insert into public.tasks (id, user_id, topic_id, type, title, due_date) values
  ('e0000000-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-0000000000a2', 'feynman', 'A Feynman', current_date),
  ('e0000000-0000-4000-8000-0000000000d2', 'aaaaaaaa-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-0000000000a2', 'quiz', 'A sınav', current_date);

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.set_task_status('e0000000-0000-4000-8000-0000000000d1', 'completed', current_date)$$,
  'a student can finish their own task'
);
select is(
  (select repetitions || '/' || interval_days || '/' || (next_review_on - current_date)
     from public.topics where id = 'd0000000-0000-4000-8000-0000000000a2'),
  '1/1/1',
  'finishing work by hand puts the topic on the review schedule'
);
select is(
  (select count(*)::int from public.topic_review_events where topic_id = 'd0000000-0000-4000-8000-0000000000a2'),
  1,
  'the review is written into the history'
);
select lives_ok(
  $$select public.set_task_status('e0000000-0000-4000-8000-0000000000d2', 'completed', current_date)$$,
  'a second task on the same topic can be finished'
);
select is(
  (select count(*)::int from public.topic_review_events where topic_id = 'd0000000-0000-4000-8000-0000000000a2'),
  1,
  'a topic is counted once a day, however many of its tasks are ticked'
);
select lives_ok(
  $$select public.set_task_status('e0000000-0000-4000-8000-0000000000d1', 'pending', current_date)$$,
  'a tick can be taken back'
);
select is(
  (select repetitions || '/' || coalesce(next_review_on::text, '-')
     from public.topics where id = 'd0000000-0000-4000-8000-0000000000a2'),
  '0/-',
  'taking the tick back restores the schedule exactly'
);
select throws_ok(
  $$select public.set_task_status('e0000000-0000-4000-8000-0000000000d1', 'rescheduled')$$,
  '22023',
  null,
  'only a check-in may reschedule'
);
select throws_ok(
  $$insert into public.topic_review_events
      (user_id, topic_id, reviewed_on, source, quality, ease_before, ease_after,
       interval_before, interval_after, repetitions_before, repetitions_after)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-0000000000a2',
            current_date, 'task', 5, 2.5, 2.6, 0, 99, 0, 9)$$,
  '42501',
  null,
  'the review history cannot be written by hand'
);

select lives_ok(
  $$select public.set_task_status('e0000000-0000-4000-8000-0000000000d1', 'completed', current_date)$$,
  'finishing it again counts again'
);
select lives_ok(
  $$select public.log_topic_review('d0000000-0000-4000-8000-0000000000a2', 1::smallint, current_date)$$,
  'a review can be logged without a task'
);
select is(
  (select repetitions || '/' || interval_days from public.topics where id = 'd0000000-0000-4000-8000-0000000000a2'),
  '0/1',
  'a review rated 1 resets the interval, even on a day already counted'
);

set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.topic_review_events),
  0,
  'B cannot read A''s review history'
);
select throws_ok(
  $$select public.set_task_status('e0000000-0000-4000-8000-0000000000d1', 'pending')$$,
  'P0002',
  null,
  'B cannot change the status of A''s task'
);
select throws_ok(
  $$select public.log_topic_review('d0000000-0000-4000-8000-0000000000a2', 4::smallint)$$,
  'P0002',
  null,
  'B cannot log a review on A''s topic'
);
select throws_ok(
  $$select public.record_checkin_reviews('bbbbbbbb-0000-4000-8000-000000000002',
      'f0000000-0000-4000-8000-00000000000a', '[]'::jsonb)$$,
  '42501',
  null,
  'the check-in review writer is server-only'
);
select throws_ok(
  $$select public.apply_topic_review('bbbbbbbb-0000-4000-8000-000000000002',
      'd0000000-0000-4000-8000-00000000000b', 5, current_date, 'task')$$,
  '42501',
  null,
  'the review engine itself is not callable from the app'
);
reset role;

-- A due review becomes work on the board — once per scheduled date.
update public.topics set next_review_on = current_date, review_task_on = null
 where id = 'd0000000-0000-4000-8000-0000000000a2';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select (public.ensure_review_tasks(current_date) ->> 'topics')::int),
  1,
  'a due review produces work'
);
select is(
  (select count(*)::int from public.tasks
    where topic_id = 'd0000000-0000-4000-8000-0000000000a2' and source = 'spaced_repetition'),
  2,
  'a topic whose loop is finished gets the short cycle: Feynman, then the quiz'
);
select is(
  (select (public.ensure_review_tasks(current_date) ->> 'topics')::int),
  0,
  'asking again the same day creates nothing more'
);
reset role;

-- ---------------------------------------------------------------------------
-- 16. One door for status, limits, error reports and push tokens.
-- ---------------------------------------------------------------------------
insert into public.tasks (id, user_id, topic_id, type, title, due_date, status) values
  ('e0000000-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-0000000000a2', 'quiz', 'A geciken', current_date - 5, 'rescheduled'),
  ('e0000000-0000-4000-8000-0000000000f2', 'aaaaaaaa-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-0000000000a2', 'quiz', 'A atlanacak', current_date - 5, 'pending');
insert into public.exams (id, user_id, course_id, kind, title, exam_date) values
  ('11111111-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-00000000000a', 'midterm', 'A vizesi', current_date - 1);
insert into public.topics (id, user_id, course_id, title, ease_factor, interval_days, repetitions) values
  ('d0000000-0000-4000-8000-0000000000a3', 'aaaaaaaa-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-00000000000a', 'A sınav konusu 1', 2.5, 6, 2),
  ('d0000000-0000-4000-8000-0000000000a4', 'aaaaaaaa-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-00000000000a', 'A sınav konusu 2', 2.5, 6, 2);
insert into public.exam_topics (exam_id, topic_id, user_id) values
  ('11111111-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-0000000000a3', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('11111111-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-0000000000a4', 'aaaaaaaa-0000-4000-8000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$update public.tasks set status = 'completed', completed_at = now()
     where id = 'e0000000-0000-4000-8000-0000000000f2'$$,
  '42501',
  null,
  'the app cannot flip a status around the review schedule'
);
select throws_ok(
  $$insert into public.tasks (user_id, topic_id, type, title, due_date, status, completed_at)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-0000000000a2',
            'quiz', 'hazır bitmiş', current_date, 'completed', now())$$,
  '42501',
  null,
  'the app cannot create work that is already finished'
);
select lives_ok(
  $$update public.tasks set title = 'A atlanacak iş' where id = 'e0000000-0000-4000-8000-0000000000f2'$$,
  'everything else about a task stays editable'
);
select is(
  public.move_tasks(array['e0000000-0000-4000-8000-0000000000f1'::uuid], current_date + 1),
  1,
  'overdue work can be moved to another day'
);
select is(
  (select status::text from public.tasks where id = 'e0000000-0000-4000-8000-0000000000f1'),
  'pending',
  'moving work the planner had set aside puts it back on the board'
);
select is(
  public.skip_tasks(array['e0000000-0000-4000-8000-0000000000f2'::uuid, 'e0000000-0000-4000-8000-00000000000b'::uuid]),
  1,
  'skipping touches only the caller''s own tasks'
);
select lives_ok(
  $$select public.apply_exam_retro('11111111-0000-4000-8000-0000000000a2', 5::smallint, 'iyi',
      array['d0000000-0000-4000-8000-0000000000a4'::uuid])$$,
  'the exam retro takes only what the student said'
);
select is(
  (select string_agg(repetitions || '/' || interval_days, ' ' order by title)
     from public.topics where id in ('d0000000-0000-4000-8000-0000000000a3', 'd0000000-0000-4000-8000-0000000000a4')),
  '3/15 0/1',
  'the server computes the schedule: a good exam stretches it, a flagged topic resets'
);
select is(
  (select count(*)::int from public.topic_review_events where exam_id = '11111111-0000-4000-8000-0000000000a2'),
  2,
  'the exam is written into each covered topic''s history'
);
select is(
  public.report_app_error('render', 'Ekran çöktü', '{"screen":"notebook"}'::jsonb, '1.0.0', 'android'),
  true,
  'the app can report an error'
);
select is(
  (select count(*)::int from public.app_error_reports),
  0,
  'but cannot read any report back'
);
select throws_ok(
  $$select public.hit_rate_limit('aaaaaaaa-0000-4000-8000-000000000001', 'checkin', 1, 60)$$,
  '42501',
  null,
  'rate limits are kept by the server alone'
);
select throws_ok(
  $$select public.register_push_token('herhangi bir metin', 'android')$$,
  '22023',
  null,
  'only an Expo push token is accepted'
);
select lives_ok(
  $$select public.register_push_token('ExponentPushToken[AbCdEf123456_-xyz]', 'android')$$,
  'a device registers its push token'
);
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.push_tokens),
  0,
  'B cannot see A''s devices'
);
reset role;

set local role service_role;
select is(
  (select array_agg(public.hit_rate_limit('aaaaaaaa-0000-4000-8000-000000000001', 'probe', 2, 3600)
                    order by n)::text
     from generate_series(1, 3) n),
  '{t,t,f}',
  'the third call inside the window is refused'
);
reset role;

-- ---------------------------------------------------------------------------
-- 17. The offline queue: a mistake-book entry keeps the id the phone gave it,
--     and sending it twice cannot make two.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$insert into public.topic_mistakes (id, user_id, topic_id, body)
    values ('f0000000-0000-4000-8000-0000000000aa', 'aaaaaaaa-0000-4000-8000-000000000001',
            'd0000000-0000-4000-8000-00000000000a', 'paydayı ters alıyorum')$$,
  'an entry written offline keeps the id chosen on the device'
);
select throws_ok(
  $$insert into public.topic_mistakes (id, user_id, topic_id, body)
    values ('f0000000-0000-4000-8000-0000000000aa', 'aaaaaaaa-0000-4000-8000-000000000001',
            'd0000000-0000-4000-8000-00000000000a', 'paydayı ters alıyorum')$$,
  '23505',
  null,
  'replaying the same entry is a unique violation (the app reads it as already saved), never a duplicate'
);
reset role;

-- ---------------------------------------------------------------------------
-- 18. "Grubu dağıt" still works behind the status door: a container with
--     work on it is set aside (skipped), by the student's own hand.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
insert into public.tasks (id, user_id, topic_id, type, title, due_date) values
  ('f1000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-00000000000a', 'learning', 'Öğrenme', current_date);
insert into public.tasks (id, user_id, topic_id, type, title, due_date, parent_task_id) values
  ('f1000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-00000000000a', 'concept_note', 'Konsept', current_date,
   'f1000000-0000-4000-8000-0000000000a1');
update public.tasks set completed_count = 1 where id = 'f1000000-0000-4000-8000-0000000000a1';
select is(
  public.ungroup_task('f1000000-0000-4000-8000-0000000000a1') ->> 'container',
  'set_aside',
  'ungrouping a container with work on it sets it aside instead of failing at the status door'
);
select is(
  (select status::text from public.tasks where id = 'f1000000-0000-4000-8000-0000000000a1'),
  'skipped',
  'the set-aside container is skipped'
);
reset role;

-- ---------------------------------------------------------------------------
-- 19. The weekly error digest: grouped, admin-only, and announced once.
-- ---------------------------------------------------------------------------
-- Last week, on the UTC calendar the Monday job runs on.
create temporary table digest_week as
  select (date_trunc('week', now() at time zone 'UTC') at time zone 'UTC') - interval '2 days' as at,
         (date_trunc('week', now() at time zone 'UTC') - interval '7 days')::date as week_start;
grant select on digest_week to authenticated;

insert into public.app_error_reports (user_id, source, kind, message, detail, app_version, platform, created_at) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'app', 'server',
   'task 3fa85f64-5717-4562-b3fc-2c963f66afa6 failed after 3 tries', '{"where":"[\"tasks\",\"mission\"]"}',
   '1.0.0', 'android', (select at from digest_week)),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'app', 'server',
   'task 9c858901-8a57-4791-81fe-4c455b099bc9 failed after 5 tries', '{"where":"[\"tasks\",\"mission\"]"}',
   '1.0.0', 'android', (select at from digest_week) + interval '1 hour'),
  (null, 'edge', 'daily-checkin:llm_error', 'model timed out', '{"requestId":"r-1","status":502}',
   null, null, (select at from digest_week) + interval '2 hours');

select is(
  (select count(distinct fingerprint)::int from public.app_error_reports where message like 'task % failed after % tries'),
  1,
  'the same failure on another task is one group'
);
-- Reports are not readable from a device, admins included: the tests carry
-- the group ids across the role switch.
create temporary table digest_groups as
  select distinct on (message like 'task %') message like 'task %' as is_task, fingerprint
    from public.app_error_reports
   where message like 'task % failed after % tries' or message = 'model timed out';
grant select on digest_groups to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$select public.admin_error_digest(7)$$,
  '42501',
  null,
  'a student who is not an admin cannot read the digest'
);
select throws_ok(
  $$insert into public.app_admins (user_id) values ('aaaaaaaa-0000-4000-8000-000000000001')$$,
  '42501',
  null,
  'nobody promotes themselves to admin'
);
select is(public.is_app_admin(), false, 'not an admin yet');
reset role;

-- The dashboard makes A an admin.
insert into public.app_admins (user_id) values ('aaaaaaaa-0000-4000-8000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.is_app_admin(), true, 'an admin is told so');
select is(
  (select (g ->> 'count')::int
     from jsonb_array_elements(public.admin_error_digest(14) -> 'top') g
    where g ->> 'message' like 'task % failed after % tries'),
  2,
  'the digest counts a group across tasks and students'
);
select is(
  (select jsonb_array_length(public.admin_error_group_reports(
     (select fingerprint from digest_groups where is_task)) -> 'reports')),
  2,
  'an admin reads the reports behind a group'
);
select lives_ok(
  $$select public.admin_set_error_group_resolved(
      (select fingerprint from digest_groups where not is_task), true, 'zaman aşımı uzatıldı')$$,
  'an admin marks a group as fixed'
);
reset role;

-- Fixed an hour ago — and it happens again half an hour later.
update public.error_group_states set resolved_at = now() - interval '1 hour'
 where fingerprint = (select fingerprint from digest_groups where not is_task);
insert into public.app_error_reports (source, kind, message, detail, created_at)
values ('edge', 'daily-checkin:llm_error', 'model timed out', '{"requestId":"r-2","status":502}', now() - interval '30 minutes');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select (g ->> 'isRegression')::boolean
     from jsonb_array_elements(public.admin_error_digest(14) -> 'top') g
    where g ->> 'message' = 'model timed out'),
  true,
  'a fixed group that shows up again is reported as back'
);
reset role;

select is(public.send_error_digest() >= 1, true, 'Monday''s digest is pushed to the admins'' devices');
select is(
  (select (payload ->> 'total')::int >= 3 and notified_at is not null
     from public.error_digests
    where week_start = (select week_start from digest_week)),
  true,
  'last week''s digest is stored and marked as sent'
);
select is(public.send_error_digest(), 0, 'a second run the same week sends nothing');

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.error_digests), 0, 'a student who is not an admin sees no digest');
select throws_ok(
  $$select public.admin_set_error_group_resolved((select fingerprint from digest_groups where not is_task), false)$$,
  '42501',
  null,
  'nor can they reopen a group'
);
reset role;

-- ---------------------------------------------------------------------------
-- 20. Mixed sets: built as a group, scored per topic, never cut in half.
-- ---------------------------------------------------------------------------
insert into public.topics (id, user_id, course_id, title, ease_factor, interval_days, repetitions) values
  ('d0000000-0000-4000-8000-0000000000a5', 'aaaaaaaa-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-00000000000a', 'Karışık konu 1', 2.5, 6, 2),
  ('d0000000-0000-4000-8000-0000000000a6', 'aaaaaaaa-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-00000000000a', 'Karışık konu 2', 2.5, 6, 2);
insert into public.exams (id, user_id, course_id, kind, title, exam_date) values
  ('11111111-0000-4000-8000-0000000000a3', 'aaaaaaaa-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-00000000000a', 'midterm', 'A finali', current_date + 5);

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  public.apply_exam_cram_plan('11111111-0000-4000-8000-0000000000a3', jsonb_build_array(
    jsonb_build_object('id', 'f2000000-0000-4000-8000-0000000000a1', 'topic_id', 'd0000000-0000-4000-8000-0000000000a5',
      'type', 'mock_exam', 'title', 'Karışık tekrar · 9 soru', 'instructions', 'Sıra: A B A B A B A B A',
      'estimated_minutes', 36, 'due_date', current_date + 1),
    jsonb_build_object('id', 'f2000000-0000-4000-8000-0000000000a2', 'parent_id', 'f2000000-0000-4000-8000-0000000000a1',
      'topic_id', 'd0000000-0000-4000-8000-0000000000a5', 'type', 'problem_set', 'title', 'Konu 1 · 5 soru',
      'target_count', 5, 'estimated_minutes', 20, 'due_date', current_date + 1),
    jsonb_build_object('id', 'f2000000-0000-4000-8000-0000000000a3', 'parent_id', 'f2000000-0000-4000-8000-0000000000a1',
      'topic_id', 'd0000000-0000-4000-8000-0000000000a6', 'type', 'problem_set', 'title', 'Konu 2 · 4 soru',
      'target_count', 4, 'estimated_minutes', 16, 'due_date', current_date + 1),
    -- A step that tries to hang off a task this call did not create is dropped.
    jsonb_build_object('parent_id', 'e0000000-0000-4000-8000-00000000000a',
      'topic_id', 'd0000000-0000-4000-8000-0000000000a6', 'type', 'problem_set', 'title', 'Kaçak adım',
      'target_count', 1, 'estimated_minutes', 4, 'due_date', current_date + 1)
  )) ->> 'steps',
  '2',
  'the exam plan creates a mixed set as a container with one step per topic'
);
select is(
  (select count(*)::int from public.tasks where parent_task_id = 'f2000000-0000-4000-8000-0000000000a1'
      and source = 'exam_cram' and origin_exam_id = '11111111-0000-4000-8000-0000000000a3'),
  2,
  'the steps belong to the set and to the exam'
);
select is(
  public.complete_mixed_set('f2000000-0000-4000-8000-0000000000a1', jsonb_build_array(
    jsonb_build_object('task_id', 'f2000000-0000-4000-8000-0000000000a2', 'correct', 5),
    jsonb_build_object('task_id', 'f2000000-0000-4000-8000-0000000000a3', 'correct', 1)
  )) ->> 'completed',
  '2',
  'finishing a set scores every topic in one call'
);
select is(
  (select status::text from public.tasks where id = 'f2000000-0000-4000-8000-0000000000a1'),
  'completed',
  'the set is done even though one topic went badly'
);
reset role;

select is(
  (select array[repetitions, interval_days] from public.topics where id = 'd0000000-0000-4000-8000-0000000000a6')
    || array[(select next_review_on - public.user_today('aaaaaaaa-0000-4000-8000-000000000001')
                from public.topics where id = 'd0000000-0000-4000-8000-0000000000a6')],
  array[0, 1, 1],
  'one of four right: that topic starts over and is back tomorrow'
);
select is(
  (select repetitions from public.topics where id = 'd0000000-0000-4000-8000-0000000000a5'),
  3,
  'five of five right: that topic moves on'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
-- A second, untouched set; then the plan is made again from scratch.
select lives_ok(
  $$select public.apply_exam_cram_plan('11111111-0000-4000-8000-0000000000a3', jsonb_build_array(
    jsonb_build_object('id', 'f2000000-0000-4000-8000-0000000000b1', 'topic_id', 'd0000000-0000-4000-8000-0000000000a5',
      'type', 'mock_exam', 'title', 'Karışık tekrar · 4 soru', 'estimated_minutes', 16, 'due_date', current_date + 3),
    jsonb_build_object('id', 'f2000000-0000-4000-8000-0000000000b2', 'parent_id', 'f2000000-0000-4000-8000-0000000000b1',
      'topic_id', 'd0000000-0000-4000-8000-0000000000a6', 'type', 'problem_set', 'title', 'Konu 2 · 4 soru',
      'target_count', 4, 'estimated_minutes', 16, 'due_date', current_date + 3)))$$,
  'a second set is added'
);
select is(
  public.apply_exam_cram_plan('11111111-0000-4000-8000-0000000000a3', '[]'::jsonb) ->> 'deleted',
  '1',
  'a new plan replaces the untouched set whole'
);
select is(
  (select count(*)::int from public.tasks
    where id in ('f2000000-0000-4000-8000-0000000000a1', 'f2000000-0000-4000-8000-0000000000a2',
                 'f2000000-0000-4000-8000-0000000000a3', 'f2000000-0000-4000-8000-0000000000b1',
                 'f2000000-0000-4000-8000-0000000000b2')),
  3,
  'the set already worked on stays, steps and all; the untouched one is gone with its steps'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$select public.complete_mixed_set('f2000000-0000-4000-8000-0000000000a1', '[]'::jsonb)$$,
  'P0002',
  null,
  'B cannot score A''s set'
);
reset role;

-- ---------------------------------------------------------------------------
-- 21. Attachments: on a task, through it on the topic, never someone else's.
-- ---------------------------------------------------------------------------
insert into public.tasks (id, user_id, topic_id, type, title, due_date, parent_task_id) values
  ('e2000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000a',
   'learning', 'Ekli öğrenme', current_date, null),
  ('e2000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000a',
   'problem_set', 'Ekli adım', current_date, 'e2000000-0000-4000-8000-0000000000a1'),
  ('e2000000-0000-4000-8000-0000000000a3', 'aaaaaaaa-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000a',
   'spaced_review', 'Aynı konunun tekrarı', current_date + 7, null),
  ('e2000000-0000-4000-8000-0000000000a4', 'aaaaaaaa-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000a',
   'problem_set', 'Silinecek görev', current_date, null);

-- What the Storage API would have stored: A's slides, and B's photo.
insert into storage.objects (bucket_id, name, metadata) values
  ('attachments', 'aaaaaaaa-0000-4000-8000-000000000001/f3000000-0000-4000-8000-0000000000a2.pdf',
   '{"size": 123456, "mimetype": "application/pdf"}'),
  ('attachments', 'aaaaaaaa-0000-4000-8000-000000000001/f3000000-0000-4000-8000-0000000000a5.jpg',
   '{"size": 2048, "mimetype": "image/jpeg"}'),
  ('attachments', 'bbbbbbbb-0000-4000-8000-000000000002/f3000000-0000-4000-8000-0000000000b1.jpg',
   '{"size": 4096, "mimetype": "image/jpeg"}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$insert into public.attachments (id, user_id, topic_id, task_id, kind, title, url) values
    ('f3000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001',
     'd0000000-0000-4000-8000-00000000000a', 'e2000000-0000-4000-8000-0000000000a1', 'link',
     '  Ders   videosu ', 'https://www.youtube.com/watch?v=abc')$$,
  'a student links a video to their task'
);
select is(
  (select title from public.attachments where id = 'f3000000-0000-4000-8000-0000000000a1'),
  'Ders videosu',
  'the title is tidied on the way in'
);
-- The phone claims 1 byte and a PNG; storage knows better.
select lives_ok(
  $$insert into public.attachments (id, user_id, topic_id, task_id, kind, title, storage_path, mime_type, size_bytes) values
    ('f3000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001',
     'd0000000-0000-4000-8000-00000000000b', 'e2000000-0000-4000-8000-0000000000a2', 'file', 'Slaytlar',
     'aaaaaaaa-0000-4000-8000-000000000001/f3000000-0000-4000-8000-0000000000a2.pdf', 'image/png', 1)$$,
  'an uploaded PDF is attached to a step'
);
select is(
  (select array[size_bytes::text, mime_type, topic_id::text] from public.attachments
    where id = 'f3000000-0000-4000-8000-0000000000a2'),
  array['123456', 'application/pdf', 'd0000000-0000-4000-8000-00000000000a'],
  'size and type come from storage, the topic from the task'
);
select throws_ok(
  $$insert into public.attachments (user_id, topic_id, task_id, kind, title, storage_path, mime_type, size_bytes) values
    ('aaaaaaaa-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000a',
     'e2000000-0000-4000-8000-0000000000a1', 'file', 'Hayalet',
     'aaaaaaaa-0000-4000-8000-000000000001/yok.pdf', 'application/pdf', 10)$$,
  '23503',
  null,
  'a row cannot point at a file that was never uploaded'
);
select throws_ok(
  $$insert into public.attachments (user_id, topic_id, kind, title, url) values
    ('aaaaaaaa-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000a', 'link', 'Kötü',
     'javascript:alert(1)')$$,
  '23514',
  null,
  'only web addresses are links'
);
select is(
  (select relation from public.task_materials('e2000000-0000-4000-8000-0000000000a2')
    where id = 'f3000000-0000-4000-8000-0000000000a1'),
  'group',
  'a step sees what was added to its learning task'
);
select is(
  (select array_agg(relation order by relation) from public.task_materials('e2000000-0000-4000-8000-0000000000a3')),
  array['topic', 'topic'],
  'the review of the same topic sees the topic''s material'
);
select throws_ok(
  $$update public.attachments set storage_path = 'aaaaaaaa-0000-4000-8000-000000000001/x.pdf'
     where id = 'f3000000-0000-4000-8000-0000000000a2'$$,
  '23514',
  null,
  'a file row cannot be pointed at another file'
);
select lives_ok(
  $$update public.attachments set title = 'Hafta 3 slaytları' where id = 'f3000000-0000-4000-8000-0000000000a2'$$,
  'renaming is allowed'
);

-- Deleting a task never deletes what the student added to it.
select lives_ok(
  $$insert into public.attachments (id, user_id, topic_id, task_id, kind, title, storage_path, mime_type, size_bytes) values
    ('f3000000-0000-4000-8000-0000000000a5', 'aaaaaaaa-0000-4000-8000-000000000001',
     'd0000000-0000-4000-8000-00000000000a', 'e2000000-0000-4000-8000-0000000000a4', 'file', 'Tahta',
     'aaaaaaaa-0000-4000-8000-000000000001/f3000000-0000-4000-8000-0000000000a5.jpg', 'image/jpeg', 1)$$,
  'a photo is attached to a task that will be deleted'
);
delete from public.tasks where id = 'e2000000-0000-4000-8000-0000000000a4';
select is(
  (select relation from public.topic_materials('d0000000-0000-4000-8000-00000000000a')
    where id = 'f3000000-0000-4000-8000-0000000000a5'),
  'topic',
  'its task deleted, the photo stays with the topic'
);
delete from public.attachments where id = 'f3000000-0000-4000-8000-0000000000a5';
select is(
  (select path from public.storage_trash),
  'aaaaaaaa-0000-4000-8000-000000000001/f3000000-0000-4000-8000-0000000000a5.jpg',
  'a deleted file row leaves its path for the app to clear from storage'
);
select throws_ok(
  $$select public.attachment_bytes_used('bbbbbbbb-0000-4000-8000-000000000002')$$,
  '42501',
  null,
  'nobody reads another student''s storage use'
);
select lives_ok(
  $$insert into storage.objects (bucket_id, name, metadata) values
    ('attachments', 'aaaaaaaa-0000-4000-8000-000000000001/yeni.pdf', '{"size": 10, "mimetype": "application/pdf"}')$$,
  'a student uploads into their own folder'
);
reset role;

-- A folder at 300 MB takes nothing more.
insert into storage.objects (bucket_id, name, metadata) values
  ('attachments', 'aaaaaaaa-0000-4000-8000-000000000001/buyuk.pdf', '{"size": 314572800, "mimetype": "application/pdf"}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$insert into storage.objects (bucket_id, name, metadata) values
    ('attachments', 'aaaaaaaa-0000-4000-8000-000000000001/fazla.pdf', '{"size": 10, "mimetype": "application/pdf"}')$$,
  '42501',
  null,
  'a full folder refuses the next upload'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.attachments) + (select count(*)::int from public.storage_trash)
    + (select count(*)::int from public.task_materials('e2000000-0000-4000-8000-0000000000a1')),
  0,
  'B sees none of A''s attachments, trash or materials'
);
select throws_ok(
  $$insert into public.attachments (user_id, topic_id, task_id, kind, title, url) values
    ('bbbbbbbb-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-00000000000b',
     'e2000000-0000-4000-8000-0000000000a1', 'link', 'Sızma', 'https://example.com')$$,
  '23503',
  null,
  'B cannot hang an attachment off A''s task'
);
select throws_ok(
  $$insert into public.attachments (user_id, topic_id, kind, title, url) values
    ('aaaaaaaa-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000a', 'link', 'Sahte', 'https://example.com')$$,
  '42501',
  null,
  'B cannot create an attachment in A''s name'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, metadata) values
    ('attachments', 'aaaaaaaa-0000-4000-8000-000000000001/sizma.pdf', '{"size": 10}')$$,
  '42501',
  null,
  'B cannot upload into A''s folder'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'attachments'),
  1,
  'B sees only their own files'
);
reset role;

-- ---------------------------------------------------------------------------
-- Focus Timer: pairings stay server-side, sessions are per student, and a
-- topic can only carry time for its own course.
-- ---------------------------------------------------------------------------
insert into public.focus_sessions (user_id, client_id, course_id, topic_id, kind, started_at, ended_at, minutes) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-0000000000a1',
   'c0000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-00000000000a',
   'timer', now() - interval '50 minutes', now(), 50);

select throws_ok(
  $$insert into public.focus_sessions (user_id, client_id, course_id, topic_id, kind, started_at, ended_at, minutes) values
    ('bbbbbbbb-0000-4000-8000-000000000002', '5a000000-0000-4000-8000-0000000000b9',
     'c0000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-00000000000a',
     'timer', now() - interval '5 minutes', now(), 5)$$,
  '23503',
  null,
  'a focus session cannot borrow another student''s course and topic'
);

set local role anon;
select throws_ok('select count(*) from public.focus_sessions', '42501', null, 'anon cannot read focus sessions');
select throws_ok('select public.issue_focus_timer_link()', '42501', null, 'anon cannot pair a timer');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.focus_sessions), 0, 'B sees none of A''s focus sessions');
select throws_ok(
  $$insert into public.focus_sessions (user_id, client_id, course_id, kind, started_at, ended_at, minutes) values
    ('bbbbbbbb-0000-4000-8000-000000000002', '5a000000-0000-4000-8000-0000000000b1',
     'c0000000-0000-4000-8000-00000000000b', 'timer', now() - interval '5 minutes', now(), 5)$$,
  '42501',
  null,
  'the app cannot write focus sessions directly (only the timer, through the function)'
);
select throws_ok('select count(*) from public.focus_timer_links', '42501', null, 'pairing hashes never reach the app');
select is((select count(*)::int from public.focus_timer_link_status()), 0, 'B starts with no timer');
select ok(
  (select (public.issue_focus_timer_link() ->> 'token') ~ '^[0-9a-f]{64}$'),
  'pairing hands out a 64-character token'
);
select is((select count(*)::int from public.focus_timer_link_status()), 1, 'B now has a timer');
select lives_ok('select public.revoke_focus_timer_link()', 'B can disconnect the timer');
select is((select count(*)::int from public.focus_timer_link_status()), 0, 'a disconnected timer is gone');
reset role;

-- Topic of another course of the same student: the trigger refuses it.
insert into public.courses (id, user_id, name) values
  ('c0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'A ikinci ders');
select throws_ok(
  $$insert into public.focus_sessions (user_id, client_id, course_id, topic_id, kind, started_at, ended_at, minutes) values
    ('aaaaaaaa-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-0000000000a2',
     'c0000000-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-00000000000a',
     'timer', now() - interval '5 minutes', now(), 5)$$,
  '23514',
  null,
  'time cannot be filed under a topic of a different course'
);

select * from finish();
rollback;
