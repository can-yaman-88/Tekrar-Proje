-- =============================================================================
-- Hardening: one calendar, one door for status, limits, and a way to hear back.
--
--   1. "Today" is the student's today. Every clamp that used the server's UTC
--      current_date now asks public.user_today(), which reads the profile's
--      timezone (the app keeps it in step with the device).
--   2. A task's status changes only through set_task_status (or the server).
--      Until now RLS let the app PATCH status directly, which skipped the
--      review schedule entirely. Bulk skip and move get their own functions.
--   3. The exam retro computes SM-2 itself. The app sends what the student
--      said — how it went, which topics hurt — and nothing it calculated.
--   4. Per-user rate limits for the Edge Functions that call a language model.
--   5. Error reports from the app and the Edge Functions land in one table.
--   6. Review reminders can arrive by push, from an hourly job, even when the
--      app has not been opened. The job is plain SQL plus one HTTP call.
--   7. kick_off_weekly_plans called extensions.net_http_post, which pg_net
--      does not provide (its function is net.http_post): the Monday run could
--      not have sent a single request.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. The student's calendar.
-- ----------------------------------------------------------------------------
create or replace function public.user_today(p_user_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce(
            (select p.timezone from public.profiles p where p.id = p_user_id),
            'UTC'))::date
$$;

comment on function public.user_today(uuid) is
  'Today in the student''s own timezone (profiles.timezone). Internal: every caller has already established who the student is.';

revoke execute on function public.user_today(uuid) from public, anon, authenticated;

-- The review engine, now clamped to the student's today.
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
  v_today    date := public.user_today(p_user_id);
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
  v_next := least(v_today + 365, greatest(v_next, v_today));

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
  v_today      date;
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
  v_today := public.user_today(v_user);
  v_on := least(v_today + 1, greatest(v_today - 2, coalesce(p_on, v_today)));

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
  v_today  date;
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

  v_today := public.user_today(v_user);
  v_on := least(v_today + 1, greatest(v_today - 2, coalesce(p_on, v_today)));
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

-- ----------------------------------------------------------------------------
-- The due-review job, shared by the app (on opening the board) and anything
-- the server may run for the student later. Internal; every row is pinned to
-- p_user_id.
-- ----------------------------------------------------------------------------
create or replace function public.create_due_review_tasks(
  p_user_id        uuid,
  p_today          date,
  p_max_topics     integer,
  p_budget_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blocked  smallint[];
  v_used     integer := 0;
  v_topics   integer := 0;
  v_tasks    integer := 0;
  v_next_day date;
  v_topic    record;
begin
  select coalesce(blocked_weekdays, '{}'::smallint[]) into v_blocked from public.profiles where id = p_user_id;
  v_blocked := coalesce(v_blocked, '{}'::smallint[]);
  if extract(isodow from p_today)::smallint = any (v_blocked) or p_max_topics <= 0 then
    return jsonb_build_object('topics', 0, 'tasks', 0);
  end if;

  for v_topic in
    select tp.id, tp.title, tp.next_review_on,
           exists (
             select 1 from public.tasks q
              where q.user_id = p_user_id and q.topic_id = tp.id and q.status = 'completed' and q.type = 'quiz'
           ) as quiz_done,
           exists (
             select 1 from public.tasks f
              where f.user_id = p_user_id and f.topic_id = tp.id and f.status = 'completed'
                and f.type in ('feynman', 'spaced_review', 'derivation')
           ) as feynman_done
      from public.topics tp
     where tp.user_id = p_user_id
       and tp.next_review_on is not null
       and tp.next_review_on <= p_today
       and tp.review_task_on is distinct from tp.next_review_on
       and not exists (
         select 1 from public.tasks o
          where o.user_id = p_user_id
            and o.topic_id = tp.id
            and o.status in ('pending', 'in_progress')
            and o.due_date <= p_today + 7
       )
     order by tp.next_review_on, tp.ease_factor, tp.id
     limit 20
  loop
    exit when v_topics >= p_max_topics;
    -- The first review always fits: a due review must never starve.
    exit when p_budget_minutes is not null and v_topics > 0 and v_used + 20 > p_budget_minutes;

    update public.topics
       set review_task_on = next_review_on
     where id = v_topic.id and user_id = p_user_id and review_task_on is distinct from next_review_on;
    continue when not found;

    if v_topic.quiz_done and v_topic.feynman_done then
      insert into public.tasks
        (user_id, topic_id, type, title, instructions, target_count, estimated_minutes, due_date, source)
      values
        (p_user_id, v_topic.id, 'feynman',
         left('Tekrar: ' || v_topic.title || ' — Feynman sayfası', 200),
         'Boş kâğıda, konuyu ilk kez duyan birine anlatır gibi yaz; tıkandığın yeri işaretle.',
         null, 20, p_today, 'spaced_repetition');

      v_next_day := p_today + 1;
      while extract(isodow from v_next_day)::smallint = any (v_blocked) and v_next_day < p_today + 7 loop
        v_next_day := v_next_day + 1;
      end loop;

      insert into public.tasks
        (user_id, topic_id, type, title, instructions, target_count, estimated_minutes, due_date, source)
      values
        (p_user_id, v_topic.id, 'quiz',
         left('Tekrar: ' || v_topic.title || ' — sıradaki sınav', 200),
         'Otomasyondan gelen yeni sınavı çöz; yanlışlarını Feynman sayfandaki boşluklarla eşleştir.',
         10, 20, v_next_day, 'spaced_repetition');
      v_tasks := v_tasks + 2;
    elsif v_topic.feynman_done then
      insert into public.tasks
        (user_id, topic_id, type, title, instructions, target_count, estimated_minutes, due_date, source)
      values
        (p_user_id, v_topic.id, 'quiz',
         left(v_topic.title || ' — 10 soruluk sınavı çöz', 200),
         'Otomasyonla ürettiğin 10 soruluk sınavı çöz; her yanlışta eksik kavramı not al.',
         10, 25, p_today, 'spaced_repetition');
      v_tasks := v_tasks + 1;
    else
      insert into public.tasks
        (user_id, topic_id, type, title, instructions, target_count, estimated_minutes, due_date, source)
      values
        (p_user_id, v_topic.id, 'feynman',
         left('Tekrar: ' || v_topic.title || ' — Feynman sayfası', 200),
         'Boş kâğıda, konuyu ilk kez duyan birine anlatır gibi yaz; tıkandığın yeri işaretle.',
         null, 20, p_today, 'spaced_repetition');
      v_tasks := v_tasks + 1;
    end if;

    v_used := v_used + 20;
    v_topics := v_topics + 1;
  end loop;

  return jsonb_build_object('topics', v_topics, 'tasks', v_tasks);
end;
$$;

revoke execute on function public.create_due_review_tasks(uuid, date, integer, integer) from public, anon, authenticated;

-- The app's door to it: the caller is the student, the day is clamped to theirs.
create or replace function public.ensure_review_tasks(
  p_today          date,
  p_max_topics     integer default 3,
  p_budget_minutes integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := auth.uid();
  v_today date;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  v_today := public.user_today(v_user);
  return public.create_due_review_tasks(
    v_user,
    least(v_today + 1, greatest(v_today - 1, coalesce(p_today, v_today))),
    least(6, greatest(0, coalesce(p_max_topics, 3))),
    case when p_budget_minutes is null then null else least(600, greatest(0, p_budget_minutes)) end
  );
end;
$$;

revoke execute on function public.ensure_review_tasks(date, integer, integer) from public, anon;
grant execute on function public.ensure_review_tasks(date, integer, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. One door for status.
--
--    The guard looks at who is writing, not at what: inside a security-definer
--    function (set_task_status, the check-in undo, the review job, the parent
--    sync) current_user is the function's owner; the Edge Functions write as
--    service_role. Only a bare request from the app is `authenticated`.
-- ----------------------------------------------------------------------------
create or replace function public.guard_task_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.completed_at is not null then
      raise exception 'new tasks start as pending; finish them through set_task_status'
        using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status or new.completed_at is distinct from old.completed_at then
    raise exception 'task status changes go through set_task_status' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger tasks_guard_status
  before insert or update on public.tasks
  for each row execute function public.guard_task_status();

-- "Kapat" for a pile of overdue work: set aside, never counted as a review.
create or replace function public.skip_tasks(p_task_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := auth.uid();
  v_count integer := 0;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  with skipped as (
    update public.tasks
       set status = 'skipped', completed_at = null
     where user_id = v_user
       and id = any (coalesce(p_task_ids, '{}'::uuid[]))
       and status in ('pending', 'in_progress', 'rescheduled')
    returning 1
  )
  select count(*) into v_count from skipped;
  return v_count;
end;
$$;

revoke execute on function public.skip_tasks(uuid[]) from public, anon;
grant execute on function public.skip_tasks(uuid[]) to authenticated;

-- "Önümüzdeki günlere dağıt": a new day, and work the planner had set aside
-- as rescheduled comes back onto the board. Progress is left as it is.
create or replace function public.move_tasks(p_task_ids uuid[], p_due_date date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := auth.uid();
  v_today date;
  v_count integer := 0;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  v_today := public.user_today(v_user);
  if p_due_date is null or p_due_date < v_today - 1 or p_due_date > v_today + 120 then
    raise exception 'due date out of range' using errcode = '22023';
  end if;
  with moved as (
    update public.tasks
       set due_date = p_due_date,
           status   = case when status = 'rescheduled' then 'pending'::public.task_status else status end
     where user_id = v_user
       and id = any (coalesce(p_task_ids, '{}'::uuid[]))
       and status in ('pending', 'in_progress', 'rescheduled')
    returning 1
  )
  select count(*) into v_count from moved;
  return v_count;
end;
$$;

revoke execute on function public.move_tasks(uuid[], date) from public, anon;
grant execute on function public.move_tasks(uuid[], date) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. The exam retro, computed here.
--
--    Quality: the outcome itself (1 = kötü … 5 = çok iyi); a topic the student
--    flagged as one that hurt is a failure (2) however the exam went.
-- ----------------------------------------------------------------------------
drop function if exists public.apply_exam_retro(uuid, smallint, text, jsonb);
drop function if exists public.record_exam_reviews(uuid, uuid, smallint, jsonb);

create or replace function public.apply_exam_retro(
  p_exam_id           uuid,
  p_outcome           smallint,
  p_note              text,
  p_flagged_topic_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_today   date;
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

  v_today := public.user_today(v_user);

  with covered as (
    select tp.id, tp.ease_factor, tp.interval_days, tp.repetitions, tp.next_review_on, tp.last_reviewed_at,
           case when tp.id = any (coalesce(p_flagged_topic_ids, '{}'::uuid[])) then 2 else p_outcome end as quality
      from public.topics tp
      join public.exam_topics et on et.topic_id = tp.id and et.exam_id = p_exam_id and et.user_id = v_user
     where tp.user_id = v_user
  ),
  computed as (
    select c.*,
           least(3.00, greatest(1.30, s.ease_factor)) as new_ease,
           least(365, greatest(1, s.interval_days)) as new_interval,
           least(999, greatest(0, s.repetitions)) as new_reps
      from covered c
      cross join lateral public.sm2_next(c.ease_factor, c.interval_days, c.repetitions, c.quality) s
  ),
  logged as (
    insert into public.topic_review_events
      (user_id, topic_id, reviewed_on, source, quality, confidence,
       ease_before, ease_after, interval_before, interval_after,
       repetitions_before, repetitions_after, next_review_before, next_review_on,
       last_reviewed_before, exam_id)
    select v_user, c.id, v_today, 'exam', c.quality, p_outcome,
           c.ease_factor, c.new_ease, c.interval_days, c.new_interval,
           c.repetitions, c.new_reps, c.next_review_on, v_today + c.new_interval,
           c.last_reviewed_at, p_exam_id
      from computed c
    returning 1
  ),
  updated as (
    update public.topics tp
       set ease_factor      = c.new_ease,
           interval_days    = c.new_interval,
           repetitions      = c.new_reps,
           next_review_on   = v_today + c.new_interval,
           last_reviewed_at = now()
      from computed c
     where tp.id = c.id and tp.user_id = v_user
    returning 1
  )
  select (select count(*) from updated) into v_updated;

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

revoke execute on function public.apply_exam_retro(uuid, smallint, text, uuid[]) from public, anon;
grant execute on function public.apply_exam_retro(uuid, smallint, text, uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Rate limits. One row per call; a window is counted, not stored.
-- ----------------------------------------------------------------------------
create table public.rate_limit_hits (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  bucket      text not null check (char_length(bucket) between 1 and 40),
  created_at  timestamptz not null default now()
);

create index rate_limit_hits_lookup_idx on public.rate_limit_hits (user_id, bucket, created_at desc);

-- No policies: nobody but the server reads or writes it.
alter table public.rate_limit_hits enable row level security;

create or replace function public.hit_rate_limit(
  p_user_id        uuid,
  p_bucket         text,
  p_limit          integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := now() - make_interval(secs => greatest(1, p_window_seconds));
  v_used  integer;
begin
  -- Two simultaneous calls must not both squeeze through the last slot.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_bucket, 0));

  select count(*) into v_used
    from public.rate_limit_hits
   where user_id = p_user_id and bucket = p_bucket and created_at > v_since;

  if v_used >= p_limit then
    return false;
  end if;

  insert into public.rate_limit_hits (user_id, bucket) values (p_user_id, p_bucket);
  return true;
end;
$$;

revoke execute on function public.hit_rate_limit(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(uuid, text, integer, integer) to service_role;

-- ----------------------------------------------------------------------------
-- 5. Error reports. Write-only for the app, and capped per student.
-- ----------------------------------------------------------------------------
create table public.app_error_reports (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.profiles (id) on delete cascade,
  source       text not null check (source in ('app', 'edge')),
  kind         text not null check (char_length(kind) between 1 and 60),
  message      text not null check (char_length(message) between 1 and 1000),
  detail       jsonb check (detail is null or octet_length(detail::text) <= 8192),
  app_version  text check (app_version is null or char_length(app_version) <= 40),
  platform     text check (platform is null or char_length(platform) <= 20),
  created_at   timestamptz not null default now()
);

create index app_error_reports_created_idx on public.app_error_reports (created_at desc);

-- No select policy: reports are read from the dashboard, never from a device.
alter table public.app_error_reports enable row level security;

create or replace function public.report_app_error(
  p_kind        text,
  p_message     text,
  p_detail      jsonb default null,
  p_app_version text default null,
  p_platform    text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- A crash loop must not become a flood.
  if not public.hit_rate_limit(v_user, 'error_report', 30, 3600) then
    return false;
  end if;

  insert into public.app_error_reports (user_id, source, kind, message, detail, app_version, platform)
  values (
    v_user,
    'app',
    left(coalesce(nullif(btrim(p_kind), ''), 'unknown'), 60),
    left(coalesce(nullif(btrim(p_message), ''), '(boş mesaj)'), 1000),
    case when p_detail is null or octet_length(p_detail::text) > 8192
         then case when p_detail is null then null else jsonb_build_object('truncated', true) end
         else p_detail end,
    left(p_app_version, 40),
    left(p_platform, 20)
  );
  return true;
end;
$$;

revoke execute on function public.report_app_error(text, text, jsonb, text, text) from public, anon;
grant execute on function public.report_app_error(text, text, jsonb, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Push reminders for reviews.
-- ----------------------------------------------------------------------------
create table public.push_tokens (
  token         text primary key check (char_length(token) between 10 and 200),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  platform      text not null check (platform in ('ios', 'android')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create index push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

create policy "push_tokens_select_own" on public.push_tokens
  for select to authenticated using ((select auth.uid()) = user_id);

-- A device belongs to whoever signed in on it last.
create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_\-]{8,180}\]$' then
    raise exception 'not an Expo push token' using errcode = '22023';
  end if;
  if p_platform not in ('ios', 'android') then
    raise exception 'unknown platform' using errcode = '22023';
  end if;

  insert into public.push_tokens (token, user_id, platform)
  values (p_token, v_user, p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = now();
end;
$$;

create or replace function public.unregister_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
end;
$$;

revoke execute on function public.register_push_token(text, text) from public, anon;
revoke execute on function public.unregister_push_token(text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;

alter table public.profiles
  add column review_push_hour smallint check (review_push_hour between 0 and 23),
  add column review_push_sent_on date;

comment on column public.profiles.review_push_hour is
  'Local hour to push the day''s due reviews; null = no push reminders.';
comment on column public.profiles.review_push_sent_on is
  'Local day the last review push went out, so the hourly job never sends twice.';

-- Hourly: for every student whose local hour has come, one push listing the
-- topics due today (overdue ones included), weakest first. Also prunes the
-- rate-limit log and old error reports.
create or replace function public.send_review_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access  text;
  v_profile record;
  v_count   integer;
  v_titles  text[];
  v_title   text;
  v_body    text;
  v_msgs    jsonb;
  v_sent    integer := 0;
begin
  delete from public.rate_limit_hits where created_at < now() - interval '2 days';
  delete from public.app_error_reports where created_at < now() - interval '90 days';

  begin
    select decrypted_secret into v_access from vault.decrypted_secrets where name = 'expo_access_token';
  exception when others then
    v_access := null;
  end;

  for v_profile in
    select p.id, (now() at time zone p.timezone)::date as local_today
      from public.profiles p
     where p.review_push_hour is not null
       and extract(hour from (now() at time zone p.timezone))::smallint = p.review_push_hour
       and p.review_push_sent_on is distinct from (now() at time zone p.timezone)::date
       and exists (select 1 from public.push_tokens t where t.user_id = p.id)
  loop
    begin
      select count(*), (array_agg(t.title order by t.ease_factor, t.next_review_on))[1:2]
        into v_count, v_titles
        from public.topics t
       where t.user_id = v_profile.id
         and t.next_review_on is not null
         and t.next_review_on <= v_profile.local_today;

      if v_count > 0 then
        if v_count = 1 then
          v_title := 'Tekrar zamanı';
          v_body := v_titles[1] || ' — kısa bir Feynman sayfası ve sınav seni bekliyor.';
        else
          v_title := 'Tekrar zamanı: ' || v_count || ' konu';
          v_body := v_titles[1] || ', ' || v_titles[2]
                    || case when v_count > 2 then ' ve ' || (v_count - 2) || ' konu daha' else '' end
                    || '. Görevler listende.';
        end if;

        select jsonb_agg(jsonb_build_object(
                 'to', pt.token,
                 'title', v_title,
                 'body', v_body,
                 'sound', 'default',
                 'channelId', 'reminders',
                 'data', jsonb_build_object('route', '/notebook')))
          into v_msgs
          from public.push_tokens pt
         where pt.user_id = v_profile.id;

        perform net.http_post(
          url     := 'https://exp.host/--/api/v2/push/send',
          body    := v_msgs,
          headers := jsonb_build_object('Content-Type', 'application/json', 'Accept', 'application/json')
                     || case when v_access is null then '{}'::jsonb
                             else jsonb_build_object('Authorization', 'Bearer ' || v_access) end,
          timeout_milliseconds := 10000
        );
        v_sent := v_sent + 1;
      end if;

      update public.profiles set review_push_sent_on = v_profile.local_today where id = v_profile.id;
    exception when others then
      -- One student's failure must not cost everyone else their reminder.
      raise warning 'review reminder for % failed: %', v_profile.id, sqlerrm;
    end;
  end loop;

  return v_sent;
end;
$$;

revoke execute on function public.send_review_reminders() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('review-reminders', '7 * * * *', 'select public.send_review_reminders()');
  end if;
exception
  when others then raise notice 'review-reminders zamanlanamadı: %', sqlerrm;
end
$$;

-- ----------------------------------------------------------------------------
-- 7. The Monday run, calling the function pg_net actually has.
-- ----------------------------------------------------------------------------
create or replace function public.kick_off_weekly_plans()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url   text;
  v_key   text;
  v_user  record;
  v_count integer := 0;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'weekly_plan_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'weekly_plan_key';
  if v_url is null or v_key is null then
    raise exception 'weekly_plan_url / weekly_plan_key secrets are missing';
  end if;

  for v_user in select id from public.profiles where auto_weekly_plan loop
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body    := jsonb_build_object('userId', v_user.id),
      timeout_milliseconds := 60000
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.kick_off_weekly_plans() from public, anon, authenticated;
