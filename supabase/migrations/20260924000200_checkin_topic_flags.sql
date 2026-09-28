-- =============================================================================
-- apply_daily_checkin gains p_topic_flags.
--
-- The student can now say "bu konudan elimde ileri seviye sorular var" in a
-- daily report; that single fact decides whether the planner is ever allowed to
-- schedule advanced problem sets for the topic.
--
--   p_topic_flags [{topic_id, has_advanced_material}]
--
-- The old 7-argument signature is dropped rather than overloaded: two
-- candidates with the same leading parameters would make every call ambiguous.
-- =============================================================================
drop function if exists public.apply_daily_checkin(uuid, uuid, text, text, jsonb, jsonb, jsonb);

create function public.apply_daily_checkin(
  p_user_id        uuid,
  p_daily_log_id   uuid,
  p_llm_model      text,
  p_summary        text,
  p_task_updates   jsonb,
  p_topic_reviews  jsonb,
  p_new_tasks      jsonb,
  p_topic_flags    jsonb default '[]'::jsonb
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

  -- 1. Audit rows first: they capture previous_status before the update.
  v_expected := jsonb_array_length(p_task_updates);

  insert into public.daily_log_task_updates
    (user_id, daily_log_id, task_id, previous_status, new_status,
     confidence_level, problems_solved, note)
  select p_user_id, p_daily_log_id, t.id, t.status, u.new_status,
         u.confidence_level, coalesce(u.problems_solved, u.completed_count), u.note
    from jsonb_to_recordset(p_task_updates) as u(
           task_id uuid, new_status public.task_status, confidence_level smallint,
           problems_solved smallint, completed_count smallint, note text)
    join public.tasks t on t.id = u.task_id and t.user_id = p_user_id;

  get diagnostics v_affected = row_count;
  if v_affected <> v_expected then
    raise exception 'task_updates reference % unknown task(s)', v_expected - v_affected
      using errcode = '23503';
  end if;

  -- 2. Task state transitions (absolute completed_count wins over the delta).
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

  -- 3. Spaced-repetition state per topic.
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

  -- 4. Topic flags the student stated in words ("elimde ileri seviye sorular var").
  update public.topics tp
     set has_advanced_material = f.has_advanced_material
    from jsonb_to_recordset(coalesce(p_topic_flags, '[]'::jsonb)) as f(
           topic_id uuid, has_advanced_material boolean)
   where tp.id = f.topic_id and tp.user_id = p_user_id and f.has_advanced_material is not null;

  -- 5. New work: rescheduled follow-ups and anything derived from attachments.
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

  -- 6. Close the log.
  update public.daily_logs
     set status        = 'succeeded',
         summary       = left(p_summary, 500),
         llm_model     = p_llm_model,
         error_message = null,
         processed_at  = now()
   where id = p_daily_log_id;

  return jsonb_build_object('created_task_ids', to_jsonb(v_created_ids));
end;
$$;

revoke execute on function public.apply_daily_checkin(uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_daily_checkin(uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb)
  to service_role;
