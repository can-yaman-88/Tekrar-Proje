-- =============================================================================
-- Mixed practice before an exam.
--
-- The sprint used to be topic by topic: Gauss's law on Monday, capacitance on
-- Tuesday. An exam is never that kind — each question first asks "which topic
-- is this, which method?". A mixed set asks it too: one task holding a few
-- topics' problems in a shuffled order, one step per topic underneath, so the
-- result of each topic reaches that topic's own review schedule.
--
--   1. apply_exam_cram_plan takes a set as a container and its steps (ids
--      chosen on the device, parent before child), and replaces an old plan
--      group by group: a set someone started is never cut in half.
--   2. complete_mixed_set closes a set in one call: how many of each topic's
--      problems were right becomes that topic's review — below 60 % the topic
--      comes back tomorrow, and the set still counts as done.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. The exam screen's plan, with groups.
-- ----------------------------------------------------------------------------
create or replace function public.apply_exam_cram_plan(p_exam_id uuid, p_tasks jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user     uuid := auth.uid();
  v_exam     record;
  v_deleted  integer := 0;
  v_inserted integer := 0;
  v_children integer := 0;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select id, exam_date into v_exam from public.exams where id = p_exam_id and user_id = v_user;
  if not found then
    raise exception 'exam % not found', p_exam_id using errcode = 'P0002';
  end if;

  -- Only untouched work goes, and a group goes whole or not at all: its steps
  -- leave with it (cascade), never one by one; one started step keeps the set.
  with doomed as (
    select t.id
      from public.tasks t
     where t.user_id = v_user
       and t.origin_exam_id = p_exam_id
       and t.source = 'exam_cram'
       and t.parent_task_id is null
       and t.status = 'pending'
       and t.completed_count = 0
       and not exists (select 1 from public.task_notes n where n.task_id = t.id)
       and not exists (select 1 from public.task_sessions s where s.task_id = t.id)
       and not exists (
         select 1 from public.tasks c
          where c.parent_task_id = t.id
            and (c.status <> 'pending'
                 or c.completed_count > 0
                 or exists (select 1 from public.task_notes n where n.task_id = c.id)
                 or exists (select 1 from public.task_sessions s where s.task_id = c.id)))
  ),
  removed as (
    delete from public.tasks t using doomed d where t.id = d.id and t.user_id = v_user returning 1
  )
  select count(*) into v_deleted from removed;

  -- Containers and standalone work first, so every step finds its parent.
  with added as (
    insert into public.tasks
      (id, user_id, topic_id, type, title, instructions, target_count, estimated_minutes,
       due_date, source, origin_exam_id)
    select coalesce(n.id, gen_random_uuid()), v_user, n.topic_id, n.type, n.title, n.instructions,
           n.target_count, n.estimated_minutes,
           least(greatest(n.due_date, current_date), v_exam.exam_date),
           'exam_cram'::public.task_source, p_exam_id
      from jsonb_to_recordset(p_tasks) as n(
             id uuid, parent_id uuid, topic_id uuid, type public.task_type, title text,
             instructions text, target_count smallint, estimated_minutes smallint, due_date date)
      join public.topics tp on tp.id = n.topic_id and tp.user_id = v_user
     where n.parent_id is null
    returning 1
  )
  select count(*) into v_inserted from added;

  -- Steps: only under a container this very call created for this exam.
  with added as (
    insert into public.tasks
      (id, user_id, topic_id, parent_task_id, type, title, instructions, target_count,
       estimated_minutes, due_date, source, origin_exam_id)
    select coalesce(n.id, gen_random_uuid()), v_user, n.topic_id, parent.id, n.type, n.title,
           n.instructions, n.target_count, n.estimated_minutes, parent.due_date,
           'exam_cram'::public.task_source, p_exam_id
      from jsonb_to_recordset(p_tasks) as n(
             id uuid, parent_id uuid, topic_id uuid, type public.task_type, title text,
             instructions text, target_count smallint, estimated_minutes smallint, due_date date)
      join public.topics tp on tp.id = n.topic_id and tp.user_id = v_user
      join public.tasks parent
        on parent.id = n.parent_id
       and parent.user_id = v_user
       and parent.origin_exam_id = p_exam_id
       and parent.parent_task_id is null
     where n.parent_id is not null
    returning 1
  )
  select count(*) into v_children from added;

  return jsonb_build_object('deleted', v_deleted, 'inserted', v_inserted + v_children, 'steps', v_children);
end;
$$;

revoke execute on function public.apply_exam_cram_plan(uuid, jsonb) from public, anon;
grant execute on function public.apply_exam_cram_plan(uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. "Seti bitirdim": each topic's score, in one call.
-- ----------------------------------------------------------------------------
create or replace function public.complete_mixed_set(
  p_task_id uuid,
  p_results jsonb,
  p_on      date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_result  record;
  v_step    record;
  v_done    integer := 0;
  v_reviews jsonb := '[]'::jsonb;
  v_status  jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_results is null or jsonb_typeof(p_results) <> 'array' then
    raise exception 'results must be a list' using errcode = '22023';
  end if;

  perform 1 from public.tasks
   where id = p_task_id and user_id = v_user and parent_task_id is null
     and exists (select 1 from public.tasks c where c.parent_task_id = p_task_id);
  if not found then
    raise exception 'mixed set % not found', p_task_id using errcode = 'P0002';
  end if;

  for v_result in
    select r.task_id, r.correct
      from jsonb_to_recordset(p_results) as r(task_id uuid, correct integer)
  loop
    select id, status, target_count into v_step
      from public.tasks
     where id = v_result.task_id and parent_task_id = p_task_id and user_id = v_user
       for update;
    if not found then
      continue;  -- not a step of this set
    end if;

    -- A second answer replaces the first: take the old review back first.
    if v_step.status in ('completed', 'failed') then
      perform public.set_task_status(v_step.id, 'pending', p_on, null);
    end if;

    update public.tasks
       set completed_count = coalesce(v_step.target_count, 0),
           correct_count   = case
                               when v_step.target_count is null or v_result.correct is null then null
                               else least(v_step.target_count, greatest(0, v_result.correct))
                             end
     where id = v_step.id and user_id = v_user;

    -- Accuracy decides the quality (recall_quality): below 60 % the topic
    -- starts over and is back tomorrow; the step itself is done either way.
    v_status := public.set_task_status(v_step.id, 'completed', p_on, null);
    v_reviews := v_reviews || jsonb_build_array(v_status);
    v_done := v_done + 1;
  end loop;

  return jsonb_build_object('task_id', p_task_id, 'completed', v_done, 'reviews', v_reviews);
end;
$$;

revoke execute on function public.complete_mixed_set(uuid, jsonb, date) from public, anon;
grant execute on function public.complete_mixed_set(uuid, jsonb, date) to authenticated;
