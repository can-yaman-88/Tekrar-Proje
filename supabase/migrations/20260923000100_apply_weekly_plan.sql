-- =============================================================================
-- apply_weekly_plan: replaces the generated plan for one week, in ONE transaction.
--
-- Re-running the generator must not pile duplicates on top of the old plan, and
-- must never destroy the student's own work. So it deletes only tasks that are
-- (a) machine-generated for this week, (b) still untouched: pending, nothing
-- solved, no notes, and not a follow-up created by a check-in.
--
--   p_tasks [{topic_id, type, title, instructions, target_count,
--             estimated_minutes, due_date}]
-- =============================================================================
create or replace function public.apply_weekly_plan(
  p_user_id    uuid,
  p_week_start date,
  p_week_end   date,
  p_tasks      jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted  integer := 0;
  v_inserted integer := 0;
begin
  if p_week_end < p_week_start then
    raise exception 'week_end % precedes week_start %', p_week_end, p_week_start using errcode = '22007';
  end if;

  with removable as (
    delete from public.tasks t
     where t.user_id = p_user_id
       and t.source = 'ai_weekly_plan'
       and t.status = 'pending'
       and t.completed_count = 0
       and t.rescheduled_from_task_id is null
       and t.due_date between p_week_start and p_week_end
       and not exists (select 1 from public.task_notes n where n.task_id = t.id)
    returning 1
  )
  select count(*) into v_deleted from removable;

  with inserted as (
    insert into public.tasks
      (user_id, topic_id, type, title, instructions, target_count, estimated_minutes, due_date, source)
    select p_user_id, n.topic_id, n.type, n.title, n.instructions, n.target_count,
           n.estimated_minutes, n.due_date, 'ai_weekly_plan'
      from jsonb_to_recordset(p_tasks) as n(
             topic_id uuid, type public.task_type, title text, instructions text,
             target_count smallint, estimated_minutes smallint, due_date date)
     where n.due_date between p_week_start and p_week_end
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return jsonb_build_object('deleted', v_deleted, 'inserted', v_inserted);
end;
$$;

revoke execute on function public.apply_weekly_plan(uuid, date, date, jsonb) from public, anon, authenticated;
grant execute on function public.apply_weekly_plan(uuid, date, date, jsonb) to service_role;
