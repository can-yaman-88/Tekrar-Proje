-- =============================================================================
-- apply_daily_checkin: applies a fully-computed check-in plan in ONE transaction.
--
-- The daily-checkin Edge Function does all reasoning (LLM extraction + the
-- deterministic planner + SM-2). This function only persists the result, so
-- a crash can never leave tasks half-updated or the audit trail incomplete.
--
-- Contract (all arrays may be empty):
--   p_task_updates  [{task_id, new_status, confidence_level, problems_solved, note}]
--   p_topic_reviews [{topic_id, ease_factor, interval_days, repetitions, next_review_on}]
--   p_new_tasks     [{topic_id, type, title, instructions, target_count,
--                     estimated_minutes, due_date, rescheduled_from_task_id}]
-- Returns: {"created_task_ids": [uuid, ...]}
--
-- Executable by service_role only; every statement is additionally scoped by
-- p_user_id and the composite FKs reject cross-user references.
-- =============================================================================
create or replace function public.apply_daily_checkin(
  p_user_id        uuid,
  p_daily_log_id   uuid,
  p_llm_model      text,
  p_summary        text,
  p_task_updates   jsonb,
  p_topic_reviews  jsonb,
  p_new_tasks      jsonb
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
  -- 0. Lock the log and make sure this invocation still owns it.
  select status into v_log_status
    from public.daily_logs
   where id = p_daily_log_id and user_id = p_user_id
     for update;

  if not found then
    raise exception 'daily_log % not found', p_daily_log_id using errcode = 'P0002';
  end if;
  if v_log_status <> 'processing' then
    raise exception 'daily_log % is %, expected processing', p_daily_log_id, v_log_status
      using errcode = '55000';  -- object_not_in_prerequisite_state
  end if;

  -- 1. Audit rows first: they capture previous_status before the update.
  v_expected := jsonb_array_length(p_task_updates);

  insert into public.daily_log_task_updates
    (user_id, daily_log_id, task_id, previous_status, new_status,
     confidence_level, problems_solved, note)
  select p_user_id, p_daily_log_id, t.id, t.status, u.new_status,
         u.confidence_level, u.problems_solved, u.note
    from jsonb_to_recordset(p_task_updates) as u(
           task_id uuid, new_status public.task_status, confidence_level smallint,
           problems_solved smallint, note text)
    join public.tasks t on t.id = u.task_id and t.user_id = p_user_id;

  get diagnostics v_affected = row_count;
  if v_affected <> v_expected then
    raise exception 'task_updates reference % unknown task(s)', v_expected - v_affected
      using errcode = '23503';
  end if;

  -- 2. Task state transitions.
  update public.tasks t
     set status           = u.new_status,
         confidence_level = coalesce(u.confidence_level, t.confidence_level),
         completed_count  = least(t.completed_count + coalesce(u.problems_solved, 0), 32767),
         completed_at     = case when u.new_status = 'completed'
                                 then coalesce(t.completed_at, now()) end
    from jsonb_to_recordset(p_task_updates) as u(
           task_id uuid, new_status public.task_status, confidence_level smallint,
           problems_solved smallint)
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

  -- 4. Rescheduled / remedial tasks (composite FKs reject foreign topic ids).
  with inserted as (
    insert into public.tasks
      (user_id, topic_id, type, title, instructions, target_count, estimated_minutes,
       due_date, source, rescheduled_from_task_id, origin_daily_log_id)
    select p_user_id, n.topic_id, n.type, n.title, n.instructions, n.target_count,
           n.estimated_minutes, n.due_date, 'ai_checkin_reschedule',
           n.rescheduled_from_task_id, p_daily_log_id
      from jsonb_to_recordset(p_new_tasks) as n(
             topic_id uuid, type public.task_type, title text, instructions text,
             target_count smallint, estimated_minutes smallint, due_date date,
             rescheduled_from_task_id uuid)
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_created_ids from inserted;

  -- 5. Close the log.
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

revoke execute on function public.apply_daily_checkin(uuid, uuid, text, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_daily_checkin(uuid, uuid, text, text, jsonb, jsonb, jsonb)
  to service_role;
