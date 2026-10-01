-- =============================================================================
-- The rest of what a busy student says in a report.
--
-- "Plan dışı 15 türev sorusu çözdüm", "vizeden 65 aldım", "fizik ödevi acil",
-- "vize için plan çıkar", "yarın 9'da hatırlat", "az önceki raporu geri al" —
-- each had nowhere to go, so each landed in "bunları bir göreve bağlayamadım".
--
-- Most of them ride on what already exists: the review schedule of an exam's
-- topics goes through apply_daily_checkin like any other SM-2 change, a sprint
-- plan's tasks are ordinary new tasks, the undo is revert_daily_checkin. What
-- is new here is only what those paths cannot carry:
--
--   · tasks.is_priority — "acil" as a fact on the task, which the task board
--     sorts by and the check-in's day repairs leave where it is;
--   · daily_logs.result — the response the check-in returned. A phone that lost
--     the connection used to get back a few counts; it now gets the list of
--     what was understood, the answers, and the reminders it has to schedule;
--   · apply_checkin_extras — off-plan work as finished tasks, an exam's result,
--     priority flags, and the sprint tasks' link to their exam;
--   · a ledger of those, and a trigger that takes them back when the check-in
--     is undone, hooked onto reverted_at exactly like restore_checkin_edits.
-- =============================================================================
alter table public.tasks
  add column is_priority boolean not null default false;

comment on column public.tasks.is_priority is
  'Marked urgent by the student. Sorted first on the task board; check-in day repairs do not move it.';

alter table public.daily_logs
  add column result jsonb;

comment on column public.daily_logs.result is
  'The response the check-in returned (DailyCheckinResponse), so a client that lost it can read it back.';

create table public.daily_log_extras (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  daily_log_id  uuid not null,
  kind          text not null check (kind in ('extra_work', 'exam_result', 'priority')),
  /** The task or exam the change was made to. */
  target_id     uuid not null,
  /** What the target held before; null for a row this check-in created. */
  previous      jsonb,
  created_at    timestamptz not null default now(),

  constraint daily_log_extras_log_fk
    foreign key (daily_log_id, user_id) references public.daily_logs (id, user_id)
    on delete cascade
);

create index daily_log_extras_log_idx on public.daily_log_extras (daily_log_id);

alter table public.daily_log_extras enable row level security;

create policy "daily_log_extras_select_own" on public.daily_log_extras
  for select to authenticated using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Apply. Runs straight after apply_daily_checkin, on the same log, and only
-- while that log is still the successful, un-reverted one it just closed.
-- ----------------------------------------------------------------------------
create or replace function public.apply_checkin_extras(
  p_user_id       uuid,
  p_daily_log_id  uuid,
  p_extra_work    jsonb default '[]'::jsonb,
  p_exam_results  jsonb default '[]'::jsonb,
  p_priorities    jsonb default '[]'::jsonb,
  p_exam_links    jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_log       record;
  v_extra     integer := 0;
  v_exams     integer := 0;
  v_flags     integer := 0;
  v_linked    integer := 0;
begin
  select status, reverted_at into v_log
    from public.daily_logs
   where id = p_daily_log_id and user_id = p_user_id
     for update;

  if not found then
    raise exception 'daily_log % not found', p_daily_log_id using errcode = 'P0002';
  end if;
  if v_log.status <> 'succeeded' or v_log.reverted_at is not null then
    raise exception 'daily_log % is not an open, processed check-in', p_daily_log_id
      using errcode = '55000';
  end if;

  -- 1. Work done outside the plan: a task that is finished the moment it
  --    exists, on the day it happened, with the numbers the student gave. The
  --    planner mints the ids, so the three statements below agree on them.
  insert into public.tasks
    (id, user_id, topic_id, type, title, target_count, completed_count, correct_count,
     estimated_minutes, due_date, status, completed_at, source, origin_daily_log_id)
  select x.id, p_user_id, x.topic_id, x.type, left(x.title, 200),
         case when x.target_count > 0 then x.target_count end,
         least(greatest(coalesce(x.completed_count, 0), 0), 9999),
         case when x.correct_count is null then null
              else least(greatest(x.correct_count, 0), least(greatest(coalesce(x.completed_count, 0), 0), 9999)) end,
         least(600, greatest(5, coalesce(x.estimated_minutes, 30))),
         x.on_date, 'completed',
         -- Noon UTC keeps the day the same wherever the student is.
         (x.on_date + time '12:00') at time zone 'UTC',
         'manual', p_daily_log_id
    from jsonb_to_recordset(coalesce(p_extra_work, '[]'::jsonb)) as x(
           id uuid, topic_id uuid, type public.task_type, title text, target_count smallint,
           completed_count smallint, correct_count smallint, estimated_minutes smallint, on_date date)
    join public.topics tp on tp.id = x.topic_id and tp.user_id = p_user_id
   where x.id is not null and x.on_date is not null;
  get diagnostics v_extra = row_count;

  -- Time they said it took is time measured, exactly like a hand-logged session.
  insert into public.task_sessions (user_id, task_id, started_at, ended_at, minutes, source_daily_log_id)
  select p_user_id, t.id,
         (t.due_date + time '12:00') at time zone 'UTC',
         (t.due_date + time '12:00') at time zone 'UTC' + make_interval(mins => x.session_minutes),
         x.session_minutes, p_daily_log_id
    from jsonb_to_recordset(coalesce(p_extra_work, '[]'::jsonb)) as x(id uuid, session_minutes smallint)
    join public.tasks t on t.id = x.id and t.user_id = p_user_id and t.origin_daily_log_id = p_daily_log_id
   where x.session_minutes between 1 and 1440;

  insert into public.daily_log_extras (user_id, daily_log_id, kind, target_id)
  select p_user_id, p_daily_log_id, 'extra_work', t.id
    from jsonb_to_recordset(coalesce(p_extra_work, '[]'::jsonb)) as x(id uuid)
    join public.tasks t on t.id = x.id and t.user_id = p_user_id and t.origin_daily_log_id = p_daily_log_id;

  -- 2. An exam's result: the exam row remembers it, and the ledger remembers
  --    what it said before. The review schedule of its topics travelled with
  --    apply_daily_checkin, where every topic change is already snapshotted.
  with results as (
    select distinct on (r.exam_id) r.exam_id, r.outcome, r.note
      from jsonb_to_recordset(coalesce(p_exam_results, '[]'::jsonb)) as r(exam_id uuid, outcome smallint, note text)
     where r.outcome between 1 and 5
  ),
  ledger as (
    insert into public.daily_log_extras (user_id, daily_log_id, kind, target_id, previous)
    select p_user_id, p_daily_log_id, 'exam_result', e.id,
           jsonb_build_object('outcome', e.outcome, 'outcome_note', e.outcome_note, 'reviewed_at', e.reviewed_at)
      from results r
      join public.exams e on e.id = r.exam_id and e.user_id = p_user_id
    returning target_id
  )
  update public.exams e
     set outcome      = r.outcome,
         outcome_note = coalesce(left(r.note, 500), e.outcome_note),
         reviewed_at  = now()
    from results r
   where e.id = r.exam_id and e.user_id = p_user_id and e.id in (select target_id from ledger);
  get diagnostics v_exams = row_count;

  -- 3. "Acil" — and "artık acil değil".
  with flags as (
    select distinct on (f.task_id) f.task_id, f.is_priority
      from jsonb_to_recordset(coalesce(p_priorities, '[]'::jsonb)) as f(task_id uuid, is_priority boolean)
     where f.is_priority is not null
  ),
  ledger as (
    insert into public.daily_log_extras (user_id, daily_log_id, kind, target_id, previous)
    select p_user_id, p_daily_log_id, 'priority', t.id, jsonb_build_object('is_priority', t.is_priority)
      from flags f
      join public.tasks t on t.id = f.task_id and t.user_id = p_user_id
     where t.is_priority is distinct from f.is_priority
    returning target_id
  )
  update public.tasks t
     set is_priority = f.is_priority
    from flags f
   where t.id = f.task_id and t.user_id = p_user_id and t.id in (select target_id from ledger);
  get diagnostics v_flags = row_count;

  -- 4. Sprint tasks this check-in created belong to their exam, so the exam
  --    screen counts them and closes them when the exam is behind.
  update public.tasks t
     set origin_exam_id = l.exam_id
    from jsonb_to_recordset(coalesce(p_exam_links, '[]'::jsonb)) as l(task_id uuid, exam_id uuid)
    join public.exams e on e.id = l.exam_id and e.user_id = p_user_id
   where t.id = l.task_id and t.user_id = p_user_id and t.origin_daily_log_id = p_daily_log_id;
  get diagnostics v_linked = row_count;

  return jsonb_build_object('extra_work', v_extra, 'exam_results', v_exams, 'priorities', v_flags, 'linked', v_linked);
end;
$$;

comment on function public.apply_checkin_extras(uuid, uuid, jsonb, jsonb, jsonb, jsonb) is
  'Off-plan work, exam results, priority flags and sprint links from a check-in; undone with it.';

revoke execute on function public.apply_checkin_extras(uuid, uuid, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_checkin_extras(uuid, uuid, jsonb, jsonb, jsonb, jsonb)
  to service_role;

-- ----------------------------------------------------------------------------
-- Undo. Off-plan work goes — it only ever existed because the report said so,
-- and finishing it is what it was created as, so the "untouched" test the
-- undo applies to other new work would keep it forever. The exam and the flags
-- go back to what the ledger says they were.
-- ----------------------------------------------------------------------------
create or replace function public.undo_checkin_extras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.tasks t
   using public.daily_log_extras x
   where x.daily_log_id = new.id and x.user_id = new.user_id and x.kind = 'extra_work'
     and t.id = x.target_id and t.user_id = new.user_id;

  update public.exams e
     set outcome      = (x.previous ->> 'outcome')::smallint,
         outcome_note = x.previous ->> 'outcome_note',
         reviewed_at  = (x.previous ->> 'reviewed_at')::timestamptz
    from public.daily_log_extras x
   where x.daily_log_id = new.id and x.user_id = new.user_id and x.kind = 'exam_result'
     and e.id = x.target_id and e.user_id = new.user_id;

  update public.tasks t
     set is_priority = coalesce((x.previous ->> 'is_priority')::boolean, false)
    from public.daily_log_extras x
   where x.daily_log_id = new.id and x.user_id = new.user_id and x.kind = 'priority'
     and t.id = x.target_id and t.user_id = new.user_id;

  return new;
end;
$$;

create trigger daily_logs_undo_checkin_extras
  after update of reverted_at on public.daily_logs
  for each row
  when (old.reverted_at is null and new.reverted_at is not null)
  execute function public.undo_checkin_extras();
