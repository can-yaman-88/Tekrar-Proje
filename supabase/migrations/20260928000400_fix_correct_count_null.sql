-- =============================================================================
-- Never invent an accuracy the student did not report.
--
-- The clamp that keeps correct_count inside completed_count was written as
--   least(coalesce(u.correct_count, t.correct_count), <completed>)
-- and Postgres's least() ignores NULLs: least(NULL, 10) is 10. So a report of
-- "10 soru çözdüm", with nothing said about right and wrong, was stored as ten
-- correct out of ten — a perfect score the student never claimed, shown on the
-- card and counted in the course's accuracy.
--
-- The clamp now only runs when there is a number to clamp.
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
         -- Only a reported number is stored, and only then is it clamped.
         correct_count    = case
                              when coalesce(u.correct_count, t.correct_count) is null then null
                              else least(
                                     coalesce(u.correct_count, t.correct_count),
                                     greatest(
                                       0,
                                       least(
                                         coalesce(
                                           u.completed_count,
                                           t.completed_count + coalesce(u.problems_solved, 0)
                                         ),
                                         32767
                                       )
                                     )
                                   )
                            end,
         completed_at     = case when u.new_status = 'completed'
                                 then coalesce(t.completed_at, now()) end
    from jsonb_to_recordset(p_task_updates) as u(
           task_id uuid, new_status public.task_status, confidence_level smallint,
           problems_solved smallint, completed_count smallint, correct_count smallint)
   where t.id = u.task_id and t.user_id = p_user_id;

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

  update public.topics tp
     set has_advanced_material = f.has_advanced_material
    from jsonb_to_recordset(coalesce(p_topic_flags, '[]'::jsonb)) as f(
           topic_id uuid, has_advanced_material boolean)
   where tp.id = f.topic_id and tp.user_id = p_user_id and f.has_advanced_material is not null;

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

-- The same fabricated score was already written for anyone who reported work
-- without an accuracy: a perfect score equal to the number solved. It cannot
-- be told apart from a real 10/10 after the fact, so only the impossible ones
-- are cleared: rows where nothing was ever reported through the audit trail.
update public.tasks t
   set correct_count = null
 where t.correct_count is not null
   and not exists (
     select 1 from public.daily_log_task_updates u
      where u.task_id = t.id and u.correct_count is not null
   );
