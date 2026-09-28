-- =============================================================================
-- Removing work from a check-in.
--
-- Until now a check-in could only say what happened to a task. But half of what
-- a student tells their planner is that something should not be there at all:
-- "Statik dersinde hiçbir şey işlenmedi, ilk haftanın görevlerini sil",
-- "bu ödev bu haftaki üç görevi karşılıyor". Without a way to say that, the
-- plan only ever grows, and the student stops trusting it.
--
-- Two rules shape this:
--   · Work the student actually touched is never destroyed. A task with
--     progress, notes or a timed session is set aside ('skipped'), not deleted.
--   · Everything is reversible. Deleted rows are snapshotted in full, so
--     public.revert_daily_checkin() can put them back exactly as they were.
-- =============================================================================
create table public.daily_log_task_deletions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  daily_log_id  uuid not null,
  task_id       uuid not null,
  /** The whole row, as it was. Not a foreign key: the task is gone. */
  snapshot      jsonb not null,
  reason        text,
  created_at    timestamptz not null default now(),

  constraint daily_log_task_deletions_log_task_key unique (daily_log_id, task_id),
  constraint daily_log_task_deletions_log_fk
    foreign key (daily_log_id, user_id) references public.daily_logs (id, user_id) on delete cascade
);

create index daily_log_task_deletions_log_idx on public.daily_log_task_deletions (daily_log_id);

alter table public.daily_log_task_deletions enable row level security;

create policy "daily_log_task_deletions_select_own" on public.daily_log_task_deletions
  for select to authenticated using ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- apply_daily_checkin now also removes.
-- ----------------------------------------------------------------------------
create or replace function public.apply_daily_checkin(
  p_user_id        uuid,
  p_daily_log_id   uuid,
  p_llm_model      text,
  p_summary        text,
  p_task_updates   jsonb,
  p_topic_reviews  jsonb,
  p_new_tasks      jsonb,
  p_topic_flags    jsonb default '[]'::jsonb,
  p_task_removals  jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_log_status  public.processing_status;
  v_expected    integer;
  v_affected    integer;
  v_created_ids uuid[];
  v_removed_ids uuid[];
begin
  select status into v_log_status
    from public.daily_logs
   where id = p_daily_log_id and user_id = p_user_id
     for update;

  if not found then
    raise exception 'daily_log % not found', p_daily_log_id using errcode = 'P0002';
  end if;
  if v_log_status <> 'processing' then
    raise exception 'daily_log % is %, expected processing', p_daily_log_id, v_log_status
      using errcode = '55000';
  end if;

  -- 1. Task audit first: it captures the row as it is right now.
  v_expected := jsonb_array_length(p_task_updates);

  insert into public.daily_log_task_updates
    (user_id, daily_log_id, task_id, previous_status, new_status,
     confidence_level, problems_solved, note,
     previous_completed_count, previous_confidence_level, previous_completed_at)
  select p_user_id, p_daily_log_id, t.id, t.status, u.new_status,
         u.confidence_level, coalesce(u.problems_solved, u.completed_count), u.note,
         t.completed_count, t.confidence_level, t.completed_at
    from jsonb_to_recordset(p_task_updates) as u(
           task_id uuid, new_status public.task_status, confidence_level smallint,
           problems_solved smallint, completed_count smallint, note text)
    join public.tasks t on t.id = u.task_id and t.user_id = p_user_id;

  get diagnostics v_affected = row_count;
  if v_affected <> v_expected then
    raise exception 'task_updates reference % unknown task(s)', v_expected - v_affected
      using errcode = '23503';
  end if;

  -- 2. Topic snapshots, for every topic this check-in is about to touch.
  insert into public.daily_log_topic_updates
    (user_id, daily_log_id, topic_id, previous_ease_factor, previous_interval_days,
     previous_repetitions, previous_next_review_on, previous_last_reviewed_at,
     previous_has_advanced_material)
  select p_user_id, p_daily_log_id, tp.id, tp.ease_factor, tp.interval_days,
         tp.repetitions, tp.next_review_on, tp.last_reviewed_at, tp.has_advanced_material
    from public.topics tp
   where tp.user_id = p_user_id
     and tp.id in (
       select r.topic_id from jsonb_to_recordset(p_topic_reviews) as r(topic_id uuid)
       union
       select f.topic_id from jsonb_to_recordset(coalesce(p_topic_flags, '[]'::jsonb)) as f(topic_id uuid)
     )
  on conflict (daily_log_id, topic_id) do nothing;

  -- 3. Task state transitions (absolute completed_count wins over the delta).
  update public.tasks t
     set status           = u.new_status,
         confidence_level = coalesce(u.confidence_level, t.confidence_level),
         completed_count  = greatest(
                              0,
                              least(
                                coalesce(u.completed_count, t.completed_count + coalesce(u.problems_solved, 0)),
                                32767
                              )
                            ),
         completed_at     = case when u.new_status = 'completed'
                                 then coalesce(t.completed_at, now()) end
    from jsonb_to_recordset(p_task_updates) as u(
           task_id uuid, new_status public.task_status, confidence_level smallint,
           problems_solved smallint, completed_count smallint)
   where t.id = u.task_id and t.user_id = p_user_id;

  -- 4. Spaced-repetition state per topic.
  v_expected := jsonb_array_length(p_topic_reviews);

  update public.topics tp
     set ease_factor      = r.ease_factor,
         interval_days    = r.interval_days,
         repetitions      = r.repetitions,
         next_review_on   = r.next_review_on,
         last_reviewed_at = now()
    from jsonb_to_recordset(p_topic_reviews) as r(
           topic_id uuid, ease_factor numeric, interval_days integer,
           repetitions integer, next_review_on date)
   where tp.id = r.topic_id and tp.user_id = p_user_id;

  get diagnostics v_affected = row_count;
  if v_affected <> v_expected then
    raise exception 'topic_reviews reference % unknown topic(s)', v_expected - v_affected
      using errcode = '23503';
  end if;

  -- 5. Topic flags the student stated in words.
  update public.topics tp
     set has_advanced_material = f.has_advanced_material
    from jsonb_to_recordset(coalesce(p_topic_flags, '[]'::jsonb)) as f(
           topic_id uuid, has_advanced_material boolean)
   where tp.id = f.topic_id and tp.user_id = p_user_id and f.has_advanced_material is not null;

  -- 6. Removals. Untouched work is deleted (snapshotted first); work with
  --    progress, notes or timed sessions behind it is only set aside.
  with requested as (
    select distinct r.task_id, r.reason
      from jsonb_to_recordset(coalesce(p_task_removals, '[]'::jsonb)) as r(task_id uuid, reason text)
  ),
  classified as (
    select t.id,
           req.reason,
           (t.completed_count = 0
            and t.status in ('pending', 'rescheduled')
            and not exists (select 1 from public.task_notes n where n.task_id = t.id)
            and not exists (select 1 from public.task_sessions s where s.task_id = t.id)
           ) as is_untouched,
           to_jsonb(t) as snapshot
      from requested req
      join public.tasks t on t.id = req.task_id and t.user_id = p_user_id
  ),
  snapshotted as (
    insert into public.daily_log_task_deletions (user_id, daily_log_id, task_id, snapshot, reason)
    select p_user_id, p_daily_log_id, c.id, c.snapshot, left(c.reason, 200)
      from classified c
     where c.is_untouched
    on conflict (daily_log_id, task_id) do nothing
    returning task_id
  ),
  set_aside as (
    -- Audited like any other transition, so undo restores the old status.
    insert into public.daily_log_task_updates
      (user_id, daily_log_id, task_id, previous_status, new_status, note,
       previous_completed_count, previous_confidence_level, previous_completed_at)
    select p_user_id, p_daily_log_id, t.id, t.status, 'skipped', left(c.reason, 200),
           t.completed_count, t.confidence_level, t.completed_at
      from classified c
      join public.tasks t on t.id = c.id
     where not c.is_untouched
    returning task_id
  ),
  aside_applied as (
    update public.tasks t
       set status = 'skipped'
      from set_aside s
     where t.id = s.task_id and t.user_id = p_user_id
    returning t.id
  ),
  deleted as (
    delete from public.tasks t
     using snapshotted s
     where t.id = s.task_id and t.user_id = p_user_id
    returning t.id
  )
  select coalesce(array_agg(id), '{}') into v_removed_ids
    from (select id from deleted union all select id from aside_applied) as removed;

  -- 7. New work: rescheduled follow-ups, homework, anything from attachments.
  with inserted as (
    insert into public.tasks
      (user_id, topic_id, type, title, instructions, target_count, estimated_minutes,
       due_date, source, rescheduled_from_task_id, origin_daily_log_id)
    select p_user_id, n.topic_id, n.type, n.title, n.instructions, n.target_count,
           n.estimated_minutes, n.due_date,
           coalesce(n.source, 'ai_checkin_reschedule'::public.task_source),
           n.rescheduled_from_task_id, p_daily_log_id
      from jsonb_to_recordset(p_new_tasks) as n(
             topic_id uuid, type public.task_type, title text, instructions text,
             target_count smallint, estimated_minutes smallint, due_date date,
             source public.task_source, rescheduled_from_task_id uuid)
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_created_ids from inserted;

  -- 8. Close the log.
  update public.daily_logs
     set status        = 'succeeded',
         summary       = left(p_summary, 500),
         llm_model     = p_llm_model,
         error_message = null,
         processed_at  = now()
   where id = p_daily_log_id;

  return jsonb_build_object(
    'created_task_ids', to_jsonb(v_created_ids),
    'removed_task_ids', to_jsonb(v_removed_ids)
  );
end;
$$;

revoke execute on function public.apply_daily_checkin(uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_daily_checkin(uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb, jsonb)
  to service_role;

-- The eight-argument version is gone: every caller passes removals now.
drop function if exists public.apply_daily_checkin(uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb);

-- ----------------------------------------------------------------------------
-- Undo puts deleted tasks back, exactly as they were.
-- ----------------------------------------------------------------------------
create or replace function public.revert_daily_checkin(p_daily_log_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user            uuid := auth.uid();
  v_log             record;
  v_tasks_restored  integer := 0;
  v_topics_restored integer := 0;
  v_tasks_deleted   integer := 0;
  v_tasks_recreated integer := 0;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select id, status, reverted_at into v_log
    from public.daily_logs
   where id = p_daily_log_id and user_id = v_user
     for update;

  if not found then
    raise exception 'daily_log % not found', p_daily_log_id using errcode = 'P0002';
  end if;
  if v_log.status <> 'succeeded' then
    raise exception 'only a processed check-in can be undone' using errcode = '55000';
  end if;
  if v_log.reverted_at is not null then
    raise exception 'this check-in was already undone' using errcode = '55000';
  end if;

  -- Tasks back to exactly what they were.
  update public.tasks t
     set status           = a.previous_status,
         completed_count  = coalesce(a.previous_completed_count, t.completed_count),
         confidence_level = a.previous_confidence_level,
         completed_at     = a.previous_completed_at
    from public.daily_log_task_updates a
   where a.daily_log_id = p_daily_log_id
     and a.user_id = v_user
     and t.id = a.task_id
     and t.user_id = v_user;
  get diagnostics v_tasks_restored = row_count;

  -- Deleted tasks come back from their snapshot, id and all.
  with restored as (
    insert into public.tasks
      (id, user_id, topic_id, type, title, instructions, target_count, completed_count,
       estimated_minutes, due_date, status, confidence_level, source,
       rescheduled_from_task_id, origin_daily_log_id, origin_exam_id, completed_at, created_at)
    select (d.snapshot ->> 'id')::uuid,
           v_user,
           (d.snapshot ->> 'topic_id')::uuid,
           (d.snapshot ->> 'type')::public.task_type,
           d.snapshot ->> 'title',
           d.snapshot ->> 'instructions',
           (d.snapshot ->> 'target_count')::smallint,
           coalesce((d.snapshot ->> 'completed_count')::smallint, 0),
           (d.snapshot ->> 'estimated_minutes')::smallint,
           (d.snapshot ->> 'due_date')::date,
           (d.snapshot ->> 'status')::public.task_status,
           (d.snapshot ->> 'confidence_level')::smallint,
           (d.snapshot ->> 'source')::public.task_source,
           (d.snapshot ->> 'rescheduled_from_task_id')::uuid,
           (d.snapshot ->> 'origin_daily_log_id')::uuid,
           (d.snapshot ->> 'origin_exam_id')::uuid,
           (d.snapshot ->> 'completed_at')::timestamptz,
           coalesce((d.snapshot ->> 'created_at')::timestamptz, now())
      from public.daily_log_task_deletions d
     where d.daily_log_id = p_daily_log_id
       and d.user_id = v_user
    on conflict (id) do nothing
    returning 1
  )
  select count(*) into v_tasks_recreated from restored;

  -- Spaced repetition back to the schedule it had.
  update public.topics tp
     set ease_factor           = s.previous_ease_factor,
         interval_days         = s.previous_interval_days,
         repetitions           = s.previous_repetitions,
         next_review_on        = s.previous_next_review_on,
         last_reviewed_at      = s.previous_last_reviewed_at,
         has_advanced_material = s.previous_has_advanced_material
    from public.daily_log_topic_updates s
   where s.daily_log_id = p_daily_log_id
     and s.user_id = v_user
     and tp.id = s.topic_id
     and tp.user_id = v_user;
  get diagnostics v_topics_restored = row_count;

  -- Follow-up tasks this check-in created, unless the student already used them.
  with removed as (
    delete from public.tasks t
     where t.user_id = v_user
       and t.origin_daily_log_id = p_daily_log_id
       and t.status = 'pending'
       and t.completed_count = 0
       and not exists (select 1 from public.task_notes n where n.task_id = t.id)
       and not exists (select 1 from public.task_sessions s where s.task_id = t.id)
    returning 1
  )
  select count(*) into v_tasks_deleted from removed;

  update public.daily_logs set reverted_at = now() where id = p_daily_log_id;

  return jsonb_build_object(
    'tasks_restored', v_tasks_restored,
    'topics_restored', v_topics_restored,
    'tasks_deleted', v_tasks_deleted,
    'tasks_recreated', v_tasks_recreated
  );
end;
$$;

revoke execute on function public.revert_daily_checkin(uuid) from public, anon;
grant execute on function public.revert_daily_checkin(uuid) to authenticated;
