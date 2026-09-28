-- =============================================================================
-- Removing and restoring groups without losing work.
--
-- Three faults, one root: the "was this touched?" test looked at a task and
-- never at what hangs off it.
--
--   1. Removing a parent hard-deleted it, and the cascade took its steps with
--      it — including steps with progress, notes or measured study time. The
--      undo restored the parent alone, so that work was gone for good.
--   2. The undo's cleanup of tasks a check-in had created deleted an untouched
--      parent the same way, destroying a step the student had already worked.
--   3. Restoring deleted rows inserted them in whatever order they came back,
--      so a step could be restored before its parent and be refused.
--
-- The fixes: a removal covers the whole group and classifies every row on its
-- own, a parent is protected by its steps, and restoring goes parents first.
-- =============================================================================
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
  v_child_ids   uuid[];
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
     confidence_level, problems_solved, note, correct_count,
     previous_completed_count, previous_confidence_level, previous_completed_at,
     previous_correct_count)
  select p_user_id, p_daily_log_id, t.id, t.status, u.new_status,
         u.confidence_level, coalesce(u.problems_solved, u.completed_count), u.note, u.correct_count,
         t.completed_count, t.confidence_level, t.completed_at, t.correct_count
    from jsonb_to_recordset(p_task_updates) as u(
           task_id uuid, new_status public.task_status, confidence_level smallint,
           problems_solved smallint, completed_count smallint, note text, correct_count smallint)
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
         correct_count    = least(
                              coalesce(u.correct_count, t.correct_count),
                              greatest(
                                0,
                                least(
                                  coalesce(u.completed_count, t.completed_count + coalesce(u.problems_solved, 0)),
                                  32767
                                )
                              )
                            ),
         completed_at     = case when u.new_status = 'completed'
                                 then coalesce(t.completed_at, now()) end
    from jsonb_to_recordset(p_task_updates) as u(
           task_id uuid, new_status public.task_status, confidence_level smallint,
           problems_solved smallint, completed_count smallint, correct_count smallint)
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

  -- 6. Removals.
  --
  -- Removing a group removes its steps as well, and every row is judged on its
  -- own: untouched rows are deleted (snapshotted first, so the undo can put
  -- them back), rows with progress, notes or timed sessions behind them are
  -- only set aside. A parent whose steps survive is therefore set aside too,
  -- and its steps are never destroyed by a cascade.
  with requested as (
    select distinct r.task_id, r.reason
      from jsonb_to_recordset(coalesce(p_task_removals, '[]'::jsonb)) as r(task_id uuid, reason text)
  ),
  expanded as (
    select req.task_id, req.reason from requested req
    union
    select child.id, req.reason
      from requested req
      join public.tasks child on child.parent_task_id = req.task_id and child.user_id = p_user_id
  ),
  classified as (
    select t.id,
           t.parent_task_id,
           e.reason,
           (t.completed_count = 0
            and t.status in ('pending', 'rescheduled')
            and not exists (select 1 from public.task_notes n where n.task_id = t.id)
            and not exists (select 1 from public.task_sessions s where s.task_id = t.id)
           ) as is_clean,
           to_jsonb(t) as snapshot
      from expanded e
      join public.tasks t on t.id = e.task_id and t.user_id = p_user_id
  ),
  -- A parent may only go if every step of it is going too.
  deletable as (
    select c.* from classified c
     where c.is_clean
       and not exists (
         select 1 from public.tasks child
          where child.parent_task_id = c.id
            and child.id not in (select id from classified where is_clean)
       )
  ),
  snapshotted as (
    insert into public.daily_log_task_deletions (user_id, daily_log_id, task_id, snapshot, reason)
    select p_user_id, p_daily_log_id, d.id, d.snapshot, left(d.reason, 200)
      from deletable d
    on conflict (daily_log_id, task_id) do nothing
    returning task_id
  ),
  set_aside as (
    insert into public.daily_log_task_updates
      (user_id, daily_log_id, task_id, previous_status, new_status, note,
       previous_completed_count, previous_confidence_level, previous_completed_at,
       previous_correct_count)
    select p_user_id, p_daily_log_id, t.id, t.status, 'skipped', left(c.reason, 200),
           t.completed_count, t.confidence_level, t.completed_at, t.correct_count
      from classified c
      join public.tasks t on t.id = c.id
     where c.id not in (select id from deletable)
    returning task_id
  ),
  aside_applied as (
    update public.tasks t
       set status = 'skipped'
      from set_aside s
     where t.id = s.task_id and t.user_id = p_user_id
    returning t.id
  ),
  -- Steps first, then the parents they hang off.
  deleted_children as (
    delete from public.tasks t
     using snapshotted s, classified c
     where t.id = s.task_id and c.id = s.task_id and c.parent_task_id is not null and t.user_id = p_user_id
    returning t.id
  ),
  deleted_parents as (
    delete from public.tasks t
     using snapshotted s, classified c
     where t.id = s.task_id and c.id = s.task_id and c.parent_task_id is null and t.user_id = p_user_id
    returning t.id
  )
  select coalesce(array_agg(id), '{}') into v_removed_ids
    from (
      select id from deleted_children
      union all select id from deleted_parents
      union all select id from aside_applied
    ) as removed;

  -- 7a. New work, parents first: a step cannot reference a row that is not
  --     there yet, and row order inside one INSERT is not something to rely on.
  with inserted as (
    insert into public.tasks
      (id, user_id, topic_id, type, title, instructions, target_count, estimated_minutes,
       due_date, starts_on, source, rescheduled_from_task_id, origin_daily_log_id)
    select coalesce(n.id, gen_random_uuid()), p_user_id, n.topic_id, n.type, n.title, n.instructions,
           n.target_count, n.estimated_minutes, n.due_date, n.starts_on,
           coalesce(n.source, 'ai_checkin_reschedule'::public.task_source),
           n.rescheduled_from_task_id, p_daily_log_id
      from jsonb_to_recordset(p_new_tasks) as n(
             id uuid, parent_task_id uuid, topic_id uuid, type public.task_type, title text,
             instructions text, target_count smallint, estimated_minutes smallint, due_date date,
             starts_on date, source public.task_source, rescheduled_from_task_id uuid)
     where n.parent_task_id is null
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_created_ids from inserted;

  -- 7b. Then the steps.
  with inserted_children as (
    insert into public.tasks
      (id, user_id, topic_id, parent_task_id, type, title, instructions, target_count,
       estimated_minutes, due_date, starts_on, source, origin_daily_log_id)
    select coalesce(n.id, gen_random_uuid()), p_user_id, n.topic_id, n.parent_task_id, n.type, n.title,
           n.instructions, n.target_count, n.estimated_minutes, n.due_date, n.starts_on,
           coalesce(n.source, 'homework'::public.task_source), p_daily_log_id
      from jsonb_to_recordset(p_new_tasks) as n(
             id uuid, parent_task_id uuid, topic_id uuid, type public.task_type, title text,
             instructions text, target_count smallint, estimated_minutes smallint, due_date date,
             starts_on date, source public.task_source, rescheduled_from_task_id uuid)
      join public.tasks parent on parent.id = n.parent_task_id and parent.user_id = p_user_id
     where n.parent_task_id is not null
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_child_ids from inserted_children;

  -- 8. Close the log.
  update public.daily_logs
     set status        = 'succeeded',
         summary       = left(p_summary, 500),
         llm_model     = p_llm_model,
         error_message = null,
         processed_at  = now()
   where id = p_daily_log_id;

  return jsonb_build_object(
    'created_task_ids', to_jsonb(v_created_ids || v_child_ids),
    'removed_task_ids', to_jsonb(v_removed_ids)
  );
end;
$$;

revoke execute on function public.apply_daily_checkin(uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_daily_checkin(uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb, jsonb)
  to service_role;

-- ----------------------------------------------------------------------------
-- Undo: restore parents before steps, and never delete a group that shelters
-- work the student has already done.
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
  v_children_back   integer := 0;
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

  update public.tasks t
     set status           = a.previous_status,
         completed_count  = coalesce(a.previous_completed_count, t.completed_count),
         correct_count    = a.previous_correct_count,
         confidence_level = a.previous_confidence_level,
         completed_at     = a.previous_completed_at
    from public.daily_log_task_updates a
   where a.daily_log_id = p_daily_log_id
     and a.user_id = v_user
     and t.id = a.task_id
     and t.user_id = v_user;
  get diagnostics v_tasks_restored = row_count;

  -- Deleted rows come back from their snapshots: parents first, so the steps
  -- have something to hang off.
  with restored as (
    insert into public.tasks
      (id, user_id, topic_id, parent_task_id, type, title, instructions, target_count, completed_count,
       correct_count, estimated_minutes, due_date, starts_on, status, confidence_level, source,
       rescheduled_from_task_id, origin_daily_log_id, origin_exam_id, completed_at, created_at)
    select (d.snapshot ->> 'id')::uuid, v_user, (d.snapshot ->> 'topic_id')::uuid, null,
           (d.snapshot ->> 'type')::public.task_type,
           d.snapshot ->> 'title', d.snapshot ->> 'instructions',
           (d.snapshot ->> 'target_count')::smallint,
           coalesce((d.snapshot ->> 'completed_count')::smallint, 0),
           (d.snapshot ->> 'correct_count')::smallint,
           (d.snapshot ->> 'estimated_minutes')::smallint,
           (d.snapshot ->> 'due_date')::date,
           (d.snapshot ->> 'starts_on')::date,
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
       and d.snapshot ->> 'parent_task_id' is null
    on conflict (id) do nothing
    returning 1
  )
  select count(*) into v_tasks_recreated from restored;

  with restored_children as (
    insert into public.tasks
      (id, user_id, topic_id, parent_task_id, type, title, instructions, target_count, completed_count,
       correct_count, estimated_minutes, due_date, starts_on, status, confidence_level, source,
       rescheduled_from_task_id, origin_daily_log_id, origin_exam_id, completed_at, created_at)
    select (d.snapshot ->> 'id')::uuid, v_user, (d.snapshot ->> 'topic_id')::uuid,
           (d.snapshot ->> 'parent_task_id')::uuid,
           (d.snapshot ->> 'type')::public.task_type,
           d.snapshot ->> 'title', d.snapshot ->> 'instructions',
           (d.snapshot ->> 'target_count')::smallint,
           coalesce((d.snapshot ->> 'completed_count')::smallint, 0),
           (d.snapshot ->> 'correct_count')::smallint,
           (d.snapshot ->> 'estimated_minutes')::smallint,
           (d.snapshot ->> 'due_date')::date,
           (d.snapshot ->> 'starts_on')::date,
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
       and d.snapshot ->> 'parent_task_id' is not null
       -- Only when the parent is back (or never left).
       and exists (select 1 from public.tasks p where p.id = (d.snapshot ->> 'parent_task_id')::uuid)
    on conflict (id) do nothing
    returning 1
  )
  select count(*) into v_children_back from restored_children;

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

  -- Work this check-in created, unless the student has since used it — and a
  -- parent counts as used when any of its steps has been.
  with removable as (
    select t.id, t.parent_task_id
      from public.tasks t
     where t.user_id = v_user
       and t.origin_daily_log_id = p_daily_log_id
       and t.status = 'pending'
       and t.completed_count = 0
       and not exists (select 1 from public.task_notes n where n.task_id = t.id)
       and not exists (select 1 from public.task_sessions s where s.task_id = t.id)
  ),
  keepers as (
    select p.id
      from public.tasks p
     where p.user_id = v_user
       and exists (
         select 1 from public.tasks c
          where c.parent_task_id = p.id and c.id not in (select id from removable)
       )
  ),
  removed_children as (
    delete from public.tasks t
     using removable r
     where t.id = r.id and r.parent_task_id is not null and t.id not in (select id from keepers)
    returning 1
  ),
  removed_parents as (
    delete from public.tasks t
     using removable r
     where t.id = r.id and r.parent_task_id is null and t.id not in (select id from keepers)
    returning 1
  )
  select (select count(*) from removed_children) + (select count(*) from removed_parents)
    into v_tasks_deleted;

  delete from public.topic_mistakes
   where user_id = v_user and source_daily_log_id = p_daily_log_id;

  update public.daily_logs set reverted_at = now() where id = p_daily_log_id;

  return jsonb_build_object(
    'tasks_restored', v_tasks_restored,
    'topics_restored', v_topics_restored,
    'tasks_deleted', v_tasks_deleted,
    'tasks_recreated', v_tasks_recreated + v_children_back
  );
end;
$$;

revoke execute on function public.revert_daily_checkin(uuid) from public, anon;
grant execute on function public.revert_daily_checkin(uuid) to authenticated;
