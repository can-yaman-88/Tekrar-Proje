-- =============================================================================
-- The review cycle, made visible and made to move.
--
-- Until now a topic's spaced-repetition schedule only ever changed when a
-- check-in said so. Ticking a task off by hand — the most common thing a
-- student does — left the schedule untouched, so most topics never entered
-- the cycle at all. And when one did, nothing arrived: no task until the next
-- Monday plan, no notification, and nowhere to see when it was last studied,
-- when it comes back, or how sure the student felt.
--
-- Three things fix that, all decided by deterministic code:
--
--   · topic_review_events — one row per counted review: the day it happened,
--     what it was worth (SM-2 quality, confidence, accuracy), and the schedule
--     before and after. This is the history the app shows, and what lets a
--     mistaken tick be taken back exactly.
--
--   · set_task_status / log_topic_review — the app's own way of finishing work
--     now moves the schedule, with the same rules a check-in follows: one
--     review per topic per day, practice before the due day restarts the clock
--     without stretching the interval, and a failure always resets.
--
--   · ensure_review_tasks — when a review comes due, the work appears on the
--     board that day, once per scheduled date, within the student's budget.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. The review history.
-- ----------------------------------------------------------------------------
create table public.topic_review_events (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles (id) on delete cascade,
  topic_id             uuid not null,
  /** The student's local day the review happened on, not when it was written. */
  reviewed_on          date not null,
  source               text not null check (source in ('task', 'manual', 'checkin', 'exam')),
  quality              smallint not null check (quality between 0 and 5),
  confidence           smallint check (confidence between 1 and 5),
  correct_count        smallint check (correct_count >= 0),
  attempted_count      smallint check (attempted_count >= 0),
  /** True when it came before the due day: logged, but the interval did not grow. */
  was_early            boolean not null default false,
  ease_before          numeric(4, 2) not null,
  ease_after           numeric(4, 2) not null,
  interval_before      integer not null,
  interval_after       integer not null,
  repetitions_before   integer not null,
  repetitions_after    integer not null,
  next_review_before   date,
  next_review_on       date,
  last_reviewed_before timestamptz,
  task_id              uuid,
  daily_log_id         uuid,
  exam_id              uuid,
  created_at           timestamptz not null default now(),

  constraint topic_review_events_topic_fk
    foreign key (topic_id, user_id) references public.topics (id, user_id) on delete cascade,
  constraint topic_review_events_task_fk
    foreign key (task_id, user_id) references public.tasks (id, user_id) on delete set null (task_id),
  -- Deleting a check-in's record keeps the plan it made, so its reviews stay
  -- too; undoing it (reverted_at) is what takes them back.
  constraint topic_review_events_log_fk
    foreign key (daily_log_id, user_id) references public.daily_logs (id, user_id) on delete set null (daily_log_id),
  constraint topic_review_events_exam_fk
    foreign key (exam_id, user_id) references public.exams (id, user_id) on delete set null (exam_id)
);

create index topic_review_events_topic_idx
  on public.topic_review_events (topic_id, reviewed_on desc, created_at desc);
create index topic_review_events_user_idx on public.topic_review_events (user_id, reviewed_on desc);
create index topic_review_events_task_idx on public.topic_review_events (task_id) where task_id is not null;
create index topic_review_events_log_idx on public.topic_review_events (daily_log_id) where daily_log_id is not null;

alter table public.topic_review_events enable row level security;

-- Read-only for the app: rows are written by the functions below, which know
-- the before and after of the schedule. A hand-made row could only lie.
create policy "topic_review_events_select_own" on public.topic_review_events
  for select to authenticated using ((select auth.uid()) = user_id);

comment on table public.topic_review_events is
  'One row per counted review of a topic: when, how well, and the SM-2 schedule before and after.';

-- The scheduled review date a task has already been generated for. Once per
-- date: a review task the student deleted does not come back the same day.
alter table public.topics
  add column review_task_on date;

comment on column public.topics.review_task_on is
  'next_review_on value for which ensure_review_tasks already created work; null = never.';

-- ----------------------------------------------------------------------------
-- 2. SM-2, mirrored from _shared/domain/spaced-repetition.ts.
--
-- Computed in float8 with floor(x + 0.5) so that it rounds exactly like the
-- TypeScript (Math.round on IEEE doubles): a check-in and a tap must never
-- disagree about the same review.
-- ----------------------------------------------------------------------------
create or replace function public.sm2_next(
  p_ease        numeric,
  p_interval    integer,
  p_repetitions integer,
  p_quality     integer,
  out ease_factor   numeric,
  out interval_days integer,
  out repetitions   integer
)
language sql
immutable
set search_path = ''
as $$
  select
    greatest(
      1.3::float8,
      floor(
        (p_ease::float8 + (0.1::float8 - (5 - p_quality)::float8 * (0.08::float8 + (5 - p_quality)::float8 * 0.02::float8)))
        * 100 + 0.5
      ) / 100
    )::numeric(4, 2),
    case
      when p_quality < 3 then 1
      when p_repetitions + 1 = 1 then 1
      when p_repetitions + 1 = 2 then 6
      else greatest(1, floor(p_interval::float8 * p_ease::float8 + 0.5)::integer)
    end,
    case when p_quality < 3 then 0 else p_repetitions + 1 end
$$;

comment on function public.sm2_next(numeric, integer, integer, integer) is
  'One SM-2 step. Must stay identical to reviewSm2() in _shared/domain/spaced-repetition.ts.';

-- Quality from what the student said or scored, mirroring qualityForAccuracy,
-- qualityForCompletion and qualityForFailure.
create or replace function public.recall_quality(
  p_failed     boolean,
  p_confidence smallint,
  p_correct    integer,
  p_attempted  integer
)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case
    -- Measured accuracy outranks how it felt.
    when p_correct is not null and p_attempted is not null and p_attempted > 0 then
      case
        when p_correct::float8 / p_attempted >= 0.9 then 5
        when p_correct::float8 / p_attempted >= 0.75 then 4
        when p_correct::float8 / p_attempted >= 0.6 then 3
        when p_correct::float8 / p_attempted >= 0.4 then 2
        else 1
      end
    when p_failed then
      case when p_confidence is null or p_confidence <= 1 then 0 when p_confidence = 2 then 1 else 2 end
    else
      case when p_confidence is null then 4 when p_confidence <= 2 then 3 when p_confidence = 3 then 4 else 5 end
  end::smallint
$$;

revoke execute on function public.sm2_next(numeric, integer, integer, integer) from public, anon;
revoke execute on function public.recall_quality(boolean, smallint, integer, integer) from public, anon;
grant execute on function public.sm2_next(numeric, integer, integer, integer) to authenticated, service_role;
grant execute on function public.recall_quality(boolean, smallint, integer, integer) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. One review, counted once. The rules mirror scheduleReview() in
--    _shared/domain/spaced-repetition.ts:
--
--      · a topic is counted at most once a day; a later review that day only
--        matters if it failed (failure always wins)
--      · a review older than the last counted one is history, not news
--      · a pass before the due day is practice: the clock restarts from that
--        day, the interval does not grow
--      · otherwise: plain SM-2 from the day it happened
--
--    Internal: callers have already established who the user is.
-- ----------------------------------------------------------------------------
create or replace function public.apply_topic_review(
  p_user_id    uuid,
  p_topic_id   uuid,
  p_quality    integer,
  p_on         date,
  p_source     text,
  p_confidence smallint default null,
  p_correct    integer default null,
  p_attempted  integer default null,
  p_task_id    uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topic    record;
  v_last     date;
  v_quality  integer := least(5, greatest(0, p_quality));
  v_early    boolean;
  v_ease     numeric;
  v_interval integer;
  v_reps     integer;
  v_next     date;
  v_event    uuid;
begin
  select id, ease_factor, interval_days, repetitions, next_review_on, last_reviewed_at
    into v_topic
    from public.topics
   where id = p_topic_id and user_id = p_user_id
     for update;
  if not found then
    return null;
  end if;

  select max(e.reviewed_on) into v_last
    from public.topic_review_events e
   where e.topic_id = p_topic_id and e.user_id = p_user_id;
  -- Reviews counted before this history existed only left a timestamp.
  v_last := coalesce(v_last, v_topic.last_reviewed_at::date);

  if v_last is not null and (v_last > p_on or (v_last = p_on and v_quality >= 3)) then
    return jsonb_build_object('counted', false, 'next_review_on', v_topic.next_review_on);
  end if;

  v_early := v_quality >= 3 and v_topic.next_review_on is not null and p_on < v_topic.next_review_on;

  if v_early then
    v_ease := v_topic.ease_factor;
    v_interval := v_topic.interval_days;
    v_reps := v_topic.repetitions;
    v_next := greatest(p_on + greatest(1, v_topic.interval_days), v_topic.next_review_on);
  else
    select s.ease_factor, s.interval_days, s.repetitions
      into v_ease, v_interval, v_reps
      from public.sm2_next(v_topic.ease_factor, v_topic.interval_days, v_topic.repetitions, v_quality) s;
    v_next := p_on + v_interval;
  end if;
  -- Never in the past: a review that is already late is due now.
  v_next := least(current_date + 365, greatest(v_next, current_date));

  update public.topics
     set ease_factor      = v_ease,
         interval_days    = v_interval,
         repetitions      = v_reps,
         next_review_on   = v_next,
         last_reviewed_at = now()
   where id = p_topic_id and user_id = p_user_id;

  insert into public.topic_review_events
    (user_id, topic_id, reviewed_on, source, quality, confidence, correct_count, attempted_count,
     was_early, ease_before, ease_after, interval_before, interval_after,
     repetitions_before, repetitions_after, next_review_before, next_review_on,
     last_reviewed_before, task_id)
  values
    (p_user_id, p_topic_id, p_on, p_source, v_quality, p_confidence,
     least(32767, greatest(0, p_correct))::smallint, least(32767, greatest(0, p_attempted))::smallint,
     v_early, v_topic.ease_factor, v_ease, v_topic.interval_days, v_interval,
     v_topic.repetitions, v_reps, v_topic.next_review_on, v_next,
     v_topic.last_reviewed_at, p_task_id)
  returning id into v_event;

  return jsonb_build_object(
    'counted', true,
    'event_id', v_event,
    'early', v_early,
    'interval_days', v_interval,
    'next_review_on', v_next
  );
end;
$$;

revoke execute on function public.apply_topic_review(uuid, uuid, integer, date, text, smallint, integer, integer, uuid)
  from public, anon, authenticated;

-- Takes back the review a task's completion caused — only when nothing has
-- happened to the topic since, so the schedule returns exactly where it was.
create or replace function public.undo_task_review(p_user_id uuid, p_task_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event record;
begin
  select * into v_event
    from public.topic_review_events
   where user_id = p_user_id and task_id = p_task_id and source in ('task', 'manual')
   order by created_at desc
   limit 1;
  if not found then
    return false;
  end if;

  if exists (
    select 1 from public.topic_review_events later
     where later.user_id = p_user_id
       and later.topic_id = v_event.topic_id
       and later.created_at > v_event.created_at
  ) then
    return false; -- the schedule has moved on; the history stays as it is
  end if;

  update public.topics
     set ease_factor      = v_event.ease_before,
         interval_days    = v_event.interval_before,
         repetitions      = v_event.repetitions_before,
         next_review_on   = v_event.next_review_before,
         last_reviewed_at = v_event.last_reviewed_before
   where id = v_event.topic_id
     and user_id = p_user_id
     and interval_days = v_event.interval_after
     and repetitions = v_event.repetitions_after
     and next_review_on is not distinct from v_event.next_review_on;
  if not found then
    return false; -- changed by something unlogged; leave both alone
  end if;

  delete from public.topic_review_events where id = v_event.id;
  return true;
end;
$$;

revoke execute on function public.undo_task_review(uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Finishing work by hand moves the schedule.
--
--    Every status change the app makes goes through here: the checkbox, the
--    notification's "Bitirdim", the edit form. Check-ins and the undo never
--    call it, so nothing is counted twice.
-- ----------------------------------------------------------------------------
create or replace function public.set_task_status(
  p_task_id    uuid,
  p_status     public.task_status,
  p_on         date default null,
  p_confidence smallint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user       uuid := auth.uid();
  v_task       record;
  v_on         date;
  v_confidence smallint;
  v_review     jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_status = 'rescheduled' then
    raise exception 'only a check-in reschedules work' using errcode = '22023';
  end if;
  if p_confidence is not null and (p_confidence < 1 or p_confidence > 5) then
    raise exception 'confidence must be between 1 and 5' using errcode = '22023';
  end if;

  -- The device's own date; a replayed offline tap may be a day or two late.
  v_on := least(current_date + 1, greatest(current_date - 2, coalesce(p_on, current_date)));

  select id, topic_id, status, completed_count, correct_count, confidence_level, completed_at
    into v_task
    from public.tasks
   where id = p_task_id and user_id = v_user
     for update;
  if not found then
    raise exception 'task % not found', p_task_id using errcode = 'P0002';
  end if;

  v_confidence := coalesce(p_confidence, v_task.confidence_level);

  update public.tasks
     set status           = p_status,
         confidence_level = v_confidence,
         completed_at     = case
                              when p_status <> 'completed' then null
                              when v_task.status = 'completed' then v_task.completed_at
                              else now()
                            end
   where id = p_task_id and user_id = v_user;

  if v_task.status is not distinct from p_status then
    return jsonb_build_object('task_id', p_task_id, 'review', null);
  end if;

  -- Leaving a counted state takes its review back.
  if v_task.status in ('completed', 'failed') then
    perform public.undo_task_review(v_user, p_task_id);
  end if;

  if p_status in ('completed', 'failed') then
    v_review := public.apply_topic_review(
      v_user,
      v_task.topic_id,
      public.recall_quality(
        p_status = 'failed',
        v_confidence,
        v_task.correct_count,
        case when v_task.correct_count is null then null else v_task.completed_count end
      ),
      v_on,
      'task',
      v_confidence,
      v_task.correct_count,
      case when v_task.correct_count is null then null else v_task.completed_count end,
      p_task_id
    );
  end if;

  return jsonb_build_object('task_id', p_task_id, 'review', v_review);
end;
$$;

revoke execute on function public.set_task_status(uuid, public.task_status, date, smallint) from public, anon;
grant execute on function public.set_task_status(uuid, public.task_status, date, smallint) to authenticated;

comment on function public.set_task_status(uuid, public.task_status, date, smallint) is
  'Status change made by the student. Completing or failing work counts as a review of its topic.';

-- ----------------------------------------------------------------------------
-- 5. "Bugün tekrar ettim" — a review without a task, rated 1–5.
--
--    1 means it did not come back: that is a failure and resets the interval.
--    Open review tasks for the topic, due by then, are the same act and close
--    with it.
-- ----------------------------------------------------------------------------
create or replace function public.log_topic_review(
  p_topic_id   uuid,
  p_confidence smallint,
  p_on         date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := auth.uid();
  v_on     date;
  v_failed boolean;
  v_task   uuid;
  v_closed integer := 0;
  v_review jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_confidence is null or p_confidence < 1 or p_confidence > 5 then
    raise exception 'confidence must be between 1 and 5' using errcode = '22023';
  end if;
  perform 1 from public.topics where id = p_topic_id and user_id = v_user;
  if not found then
    raise exception 'topic % not found', p_topic_id using errcode = 'P0002';
  end if;

  v_on := least(current_date + 1, greatest(current_date - 2, coalesce(p_on, current_date)));
  v_failed := p_confidence = 1;

  with closed as (
    update public.tasks t
       set status           = case when v_failed then 'failed'::public.task_status else 'completed'::public.task_status end,
           confidence_level = p_confidence,
           completed_at     = case when v_failed then null else now() end
     where t.user_id = v_user
       and t.topic_id = p_topic_id
       and t.source = 'spaced_repetition'
       and t.status in ('pending', 'in_progress')
       and t.due_date <= v_on
       and t.parent_task_id is null
    returning t.id, t.due_date
  )
  select (array_agg(id order by due_date desc))[1], count(*)
    into v_task, v_closed
    from closed;

  v_review := public.apply_topic_review(
    v_user, p_topic_id, public.recall_quality(v_failed, p_confidence, null, null),
    v_on, 'manual', p_confidence, null, null, v_task
  );

  return jsonb_build_object('review', v_review, 'tasks_closed', v_closed);
end;
$$;

revoke execute on function public.log_topic_review(uuid, smallint, date) from public, anon;
grant execute on function public.log_topic_review(uuid, smallint, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. When a review comes due, the work appears.
--
--    Called by the app when the day's board opens. Security invoker: every
--    read and write below is the student's own, under RLS.
--
--    What a review is follows the study loop (generate-weekly-plan/study-cycle):
--      · loop finished (Feynman + quiz done) → Feynman page today, quiz on the
--        next open day — the quiz is a recall test only after a gap
--      · Feynman done, quiz never → the loop's own quiz, today
--      · otherwise → the Feynman page, today
--
--    A topic with open work in the coming week already has a plan, and gets
--    nothing more. The most overdue (then the weakest) go first; the rest wait
--    for tomorrow rather than swamping today.
-- ----------------------------------------------------------------------------
create or replace function public.ensure_review_tasks(
  p_today          date,
  p_max_topics     integer default 3,
  p_budget_minutes integer default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user     uuid := auth.uid();
  v_today    date;
  v_blocked  smallint[];
  v_max      integer;
  v_budget   integer;
  v_used     integer := 0;
  v_topics   integer := 0;
  v_tasks    integer := 0;
  v_next_day date;
  v_topic    record;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  v_today := least(current_date + 1, greatest(current_date - 1, coalesce(p_today, current_date)));
  v_max := least(6, greatest(0, coalesce(p_max_topics, 3)));
  v_budget := case when p_budget_minutes is null then null else least(600, greatest(0, p_budget_minutes)) end;

  select coalesce(blocked_weekdays, '{}'::smallint[]) into v_blocked from public.profiles where id = v_user;
  -- A day the student never studies on gets no work; it waits for the next one.
  if extract(isodow from v_today)::smallint = any (coalesce(v_blocked, '{}'::smallint[])) or v_max = 0 then
    return jsonb_build_object('topics', 0, 'tasks', 0);
  end if;

  for v_topic in
    select tp.id, tp.title, tp.next_review_on,
           exists (
             select 1 from public.tasks q
              where q.user_id = v_user and q.topic_id = tp.id and q.status = 'completed' and q.type = 'quiz'
           ) as quiz_done,
           exists (
             select 1 from public.tasks f
              where f.user_id = v_user and f.topic_id = tp.id and f.status = 'completed'
                and f.type in ('feynman', 'spaced_review', 'derivation')
           ) as feynman_done
      from public.topics tp
     where tp.user_id = v_user
       and tp.next_review_on is not null
       and tp.next_review_on <= v_today
       and tp.review_task_on is distinct from tp.next_review_on
       and not exists (
         select 1 from public.tasks o
          where o.user_id = v_user
            and o.topic_id = tp.id
            and o.status in ('pending', 'in_progress')
            and o.due_date <= v_today + 7
       )
     order by tp.next_review_on, tp.ease_factor, tp.id
     limit 20
  loop
    exit when v_topics >= v_max;
    -- The first review always fits: a due review must never starve.
    exit when v_budget is not null and v_topics > 0 and v_used + 20 > v_budget;

    -- Claim the date, so a second device or a second open creates nothing.
    update public.topics
       set review_task_on = next_review_on
     where id = v_topic.id and user_id = v_user and review_task_on is distinct from next_review_on;
    continue when not found;

    if v_topic.quiz_done and v_topic.feynman_done then
      insert into public.tasks
        (user_id, topic_id, type, title, instructions, target_count, estimated_minutes, due_date, source)
      values
        (v_user, v_topic.id, 'feynman',
         left('Tekrar: ' || v_topic.title || ' — Feynman sayfası', 200),
         'Boş kâğıda, konuyu ilk kez duyan birine anlatır gibi yaz; tıkandığın yeri işaretle.',
         null, 20, v_today, 'spaced_repetition');

      v_next_day := v_today + 1;
      while extract(isodow from v_next_day)::smallint = any (coalesce(v_blocked, '{}'::smallint[]))
            and v_next_day < v_today + 7 loop
        v_next_day := v_next_day + 1;
      end loop;

      insert into public.tasks
        (user_id, topic_id, type, title, instructions, target_count, estimated_minutes, due_date, source)
      values
        (v_user, v_topic.id, 'quiz',
         left('Tekrar: ' || v_topic.title || ' — sıradaki sınav', 200),
         'Otomasyondan gelen yeni sınavı çöz; yanlışlarını Feynman sayfandaki boşluklarla eşleştir.',
         10, 20, v_next_day, 'spaced_repetition');
      v_tasks := v_tasks + 2;
    elsif v_topic.feynman_done then
      insert into public.tasks
        (user_id, topic_id, type, title, instructions, target_count, estimated_minutes, due_date, source)
      values
        (v_user, v_topic.id, 'quiz',
         left(v_topic.title || ' — 10 soruluk sınavı çöz', 200),
         'Otomasyonla ürettiğin 10 soruluk sınavı çöz; her yanlışta eksik kavramı not al.',
         10, 25, v_today, 'spaced_repetition');
      v_tasks := v_tasks + 1;
    else
      insert into public.tasks
        (user_id, topic_id, type, title, instructions, target_count, estimated_minutes, due_date, source)
      values
        (v_user, v_topic.id, 'feynman',
         left('Tekrar: ' || v_topic.title || ' — Feynman sayfası', 200),
         'Boş kâğıda, konuyu ilk kez duyan birine anlatır gibi yaz; tıkandığın yeri işaretle.',
         null, 20, v_today, 'spaced_repetition');
      v_tasks := v_tasks + 1;
    end if;

    v_used := v_used + 20;
    v_topics := v_topics + 1;
  end loop;

  return jsonb_build_object('topics', v_topics, 'tasks', v_tasks);
end;
$$;

revoke execute on function public.ensure_review_tasks(date, integer, integer) from public, anon;
grant execute on function public.ensure_review_tasks(date, integer, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Check-ins write their reviews into the same history.
--
--    Runs after apply_daily_checkin, like the mistake book: a side record that
--    never fails a check-in. The "before" comes from the snapshot the check-in
--    took for its own undo, the "after" from the topic as it now stands.
-- ----------------------------------------------------------------------------
create or replace function public.record_checkin_reviews(
  p_user_id      uuid,
  p_daily_log_id uuid,
  p_reviews      jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_added integer := 0;
begin
  perform 1 from public.daily_logs
   where id = p_daily_log_id and user_id = p_user_id and status = 'succeeded' and reverted_at is null;
  if not found then
    return 0;
  end if;

  with added as (
    insert into public.topic_review_events
      (user_id, topic_id, reviewed_on, source, quality, confidence, correct_count, attempted_count,
       was_early, ease_before, ease_after, interval_before, interval_after,
       repetitions_before, repetitions_after, next_review_before, next_review_on,
       last_reviewed_before, task_id, daily_log_id)
    select p_user_id, tp.id, r.reviewed_on, 'checkin',
           least(5, greatest(0, coalesce(r.quality, 3))),
           case when r.confidence between 1 and 5 then r.confidence end,
           least(32767, greatest(0, r.correct_count)),
           least(32767, greatest(0, r.attempted_count)),
           coalesce(r.early, false),
           s.previous_ease_factor, tp.ease_factor,
           s.previous_interval_days, tp.interval_days,
           s.previous_repetitions, tp.repetitions,
           s.previous_next_review_on, tp.next_review_on,
           s.previous_last_reviewed_at,
           (select t.id from public.tasks t where t.id = r.task_id and t.user_id = p_user_id),
           p_daily_log_id
      from jsonb_to_recordset(coalesce(p_reviews, '[]'::jsonb)) as r(
             topic_id uuid, quality integer, reviewed_on date, confidence integer,
             correct_count integer, attempted_count integer, early boolean, task_id uuid)
      join public.topics tp on tp.id = r.topic_id and tp.user_id = p_user_id
      join public.daily_log_topic_updates s
        on s.daily_log_id = p_daily_log_id and s.topic_id = tp.id and s.user_id = p_user_id
     where r.reviewed_on is not null
       and not exists (
         select 1 from public.topic_review_events e
          where e.daily_log_id = p_daily_log_id and e.topic_id = tp.id
       )
    returning 1
  )
  select count(*) into v_added from added;

  return v_added;
end;
$$;

revoke execute on function public.record_checkin_reviews(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_checkin_reviews(uuid, uuid, jsonb) to service_role;

-- Undoing a check-in takes its reviews out of the history; the schedule itself
-- is restored by revert_daily_checkin from its own snapshot.
create or replace function public.forget_checkin_reviews()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.topic_review_events
   where daily_log_id = new.id and user_id = new.user_id;
  return new;
end;
$$;

create trigger daily_logs_forget_checkin_reviews
  after update of reverted_at on public.daily_logs
  for each row
  when (old.reverted_at is null and new.reverted_at is not null)
  execute function public.forget_checkin_reviews();

-- ----------------------------------------------------------------------------
-- 8. The exam retro keeps its history too. Same behaviour as before, plus one
--    event per covered topic; the quality the app computed rides along.
--
--    Now security definer, because the history is read-only to the app. Every
--    statement is pinned to auth.uid(), exactly as RLS pinned it before.
-- ----------------------------------------------------------------------------
create or replace function public.apply_exam_retro(
  p_exam_id  uuid,
  p_outcome  smallint,
  p_note     text,
  p_reviews  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_updated integer := 0;
  v_closed  integer := 0;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome < 1 or p_outcome > 5 then
    raise exception 'outcome must be between 1 and 5' using errcode = '22023';
  end if;

  perform 1 from public.exams where id = p_exam_id and user_id = v_user;
  if not found then
    raise exception 'exam % not found', p_exam_id using errcode = 'P0002';
  end if;

  -- History first, while the topics still hold their "before".
  perform public.record_exam_reviews(v_user, p_exam_id, p_outcome, p_reviews);

  update public.topics tp
     set ease_factor      = least(3.00, greatest(1.30, r.ease_factor)),
         interval_days    = least(365, greatest(1, r.interval_days)),
         repetitions      = least(999, greatest(0, r.repetitions)),
         next_review_on   = least(current_date + 365, greatest(current_date, r.next_review_on)),
         last_reviewed_at = now()
    from jsonb_to_recordset(p_reviews) as r(
           topic_id uuid, ease_factor numeric, interval_days integer,
           repetitions integer, next_review_on date)
   where tp.id = r.topic_id
     and tp.user_id = v_user
     and exists (
       select 1 from public.exam_topics et
        where et.exam_id = p_exam_id and et.topic_id = tp.id and et.user_id = v_user
     );
  get diagnostics v_updated = row_count;

  with closed as (
    update public.tasks t
       set status = 'skipped'
     where t.user_id = v_user
       and t.origin_exam_id = p_exam_id
       and t.source = 'exam_cram'
       and t.status in ('pending', 'in_progress')
    returning 1
  )
  select count(*) into v_closed from closed;

  update public.exams
     set outcome      = p_outcome,
         outcome_note = left(p_note, 500),
         reviewed_at  = now()
   where id = p_exam_id and user_id = v_user;

  return jsonb_build_object('topics_updated', v_updated, 'tasks_closed', v_closed);
end;
$$;

-- Internal to apply_exam_retro: every row is pinned to the caller and to the
-- topics the exam really covers.
create or replace function public.record_exam_reviews(
  p_user_id uuid,
  p_exam_id uuid,
  p_outcome smallint,
  p_reviews jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_added integer := 0;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  with added as (
    insert into public.topic_review_events
      (user_id, topic_id, reviewed_on, source, quality, confidence,
       ease_before, ease_after, interval_before, interval_after,
       repetitions_before, repetitions_after, next_review_before, next_review_on,
       last_reviewed_before, exam_id)
    select p_user_id, tp.id, current_date, 'exam',
           least(5, greatest(0, coalesce(r.quality, p_outcome))),
           p_outcome,
           tp.ease_factor, least(3.00, greatest(1.30, r.ease_factor)),
           tp.interval_days, least(365, greatest(1, r.interval_days)),
           tp.repetitions, least(999, greatest(0, r.repetitions)),
           tp.next_review_on, least(current_date + 365, greatest(current_date, r.next_review_on)),
           tp.last_reviewed_at, p_exam_id
      from jsonb_to_recordset(coalesce(p_reviews, '[]'::jsonb)) as r(
             topic_id uuid, ease_factor numeric, interval_days integer,
             repetitions integer, next_review_on date, quality integer)
      join public.topics tp on tp.id = r.topic_id and tp.user_id = p_user_id
     where exists (
       select 1 from public.exam_topics et
        where et.exam_id = p_exam_id and et.topic_id = tp.id and et.user_id = p_user_id
     )
    returning 1
  )
  select count(*) into v_added from added;
  return v_added;
end;
$$;

revoke execute on function public.record_exam_reviews(uuid, uuid, smallint, jsonb) from public, anon, authenticated;
revoke execute on function public.apply_exam_retro(uuid, smallint, text, jsonb) from public, anon;
grant execute on function public.apply_exam_retro(uuid, smallint, text, jsonb) to authenticated;
