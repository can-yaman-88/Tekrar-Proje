-- =============================================================================
-- apply_weekly_plan v2: learning tasks, and a replacement that cannot eat work.
--
-- Two changes, and the second is why they must ship together.
--
--   1. The plan may now contain GROUPS: a "learning task" container with the
--      concept page and the Feynman page as its steps. Rows therefore carry
--      their own id and an optional parent, and are inserted parents-first —
--      the same two-pass shape apply_daily_checkin already uses.
--
--   2. The delete that clears last week's untouched plan is now group-aware.
--      `tasks_parent_fk` is ON DELETE CASCADE, so deleting a container takes
--      its steps with it. The old predicate looked at one row at a time: a
--      container looked untouched (pending, nothing solved, no notes) while a
--      step under it held a note, a timed session, or half-finished work — and
--      re-running the generator would have destroyed it.
--
--      Now a container is replaceable only when every step under it is, and a
--      step only when its container is. Steps are deleted before containers.
--
-- The definition of "untouched" also grows a session check: time measured
-- against a task is work, exactly as a note is.
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
  v_deleted   integer := 0;
  v_inserted  integer := 0;
  v_children  integer := 0;
begin
  if p_week_end < p_week_start then
    raise exception 'week_end % precedes week_start %', p_week_end, p_week_start using errcode = '22007';
  end if;

  with candidate as (
    select t.id, t.parent_task_id
      from public.tasks t
     where t.user_id = p_user_id
       and t.source = 'ai_weekly_plan'
       and t.status = 'pending'
       and t.completed_count = 0
       and t.rescheduled_from_task_id is null
       and t.due_date between p_week_start and p_week_end
       and not exists (select 1 from public.task_notes n where n.task_id = t.id)
       and not exists (select 1 from public.task_sessions s where s.task_id = t.id)
  ),
  -- A container whose steps are not all replaceable stays, and shelters them.
  sheltering as (
    select c.id
      from candidate c
     where exists (
       select 1 from public.tasks child
        where child.parent_task_id = c.id
          and child.id not in (select id from candidate)
     )
  ),
  removable as (
    select c.id, c.parent_task_id
      from candidate c
     where c.id not in (select id from sheltering)
       -- A step goes only with its container; a half-emptied group would be
       -- rebuilt as a duplicate next time.
       and (
         c.parent_task_id is null
         or c.parent_task_id in (select id from candidate where id not in (select id from sheltering))
       )
  ),
  deleted_children as (
    delete from public.tasks t
     using removable r
     where t.id = r.id and r.parent_task_id is not null and t.user_id = p_user_id
    returning 1
  ),
  deleted_parents as (
    delete from public.tasks t
     using removable r
     where t.id = r.id and r.parent_task_id is null and t.user_id = p_user_id
    returning 1
  )
  select (select count(*) from deleted_children) + (select count(*) from deleted_parents)
    into v_deleted;

  -- Containers first: a step cannot reference a row that is not there yet.
  with inserted as (
    insert into public.tasks
      (id, user_id, topic_id, type, title, instructions, target_count, estimated_minutes, due_date, source)
    select coalesce(n.id, gen_random_uuid()), p_user_id, n.topic_id, n.type, n.title, n.instructions,
           n.target_count, n.estimated_minutes, n.due_date, 'ai_weekly_plan'
      from jsonb_to_recordset(p_tasks) as n(
             id uuid, parent_task_id uuid, topic_id uuid, type public.task_type, title text,
             instructions text, target_count smallint, estimated_minutes smallint, due_date date)
     where n.parent_task_id is null
       and n.due_date between p_week_start and p_week_end
    returning 1
  )
  select count(*) into v_inserted from inserted;

  with inserted_children as (
    insert into public.tasks
      (id, user_id, topic_id, parent_task_id, type, title, instructions, target_count,
       estimated_minutes, due_date, source)
    select coalesce(n.id, gen_random_uuid()), p_user_id, n.topic_id, n.parent_task_id, n.type, n.title,
           n.instructions, n.target_count, n.estimated_minutes, n.due_date, 'ai_weekly_plan'
      from jsonb_to_recordset(p_tasks) as n(
             id uuid, parent_task_id uuid, topic_id uuid, type public.task_type, title text,
             instructions text, target_count smallint, estimated_minutes smallint, due_date date)
      join public.tasks parent on parent.id = n.parent_task_id and parent.user_id = p_user_id
     where n.parent_task_id is not null
       and n.due_date between p_week_start and p_week_end
    returning 1
  )
  select count(*) into v_children from inserted_children;

  return jsonb_build_object('deleted', v_deleted, 'inserted', v_inserted + v_children);
end;
$$;

comment on function public.apply_weekly_plan(uuid, date, date, jsonb) is
  'Replaces one week of generated tasks. Groups are inserted parents-first and only ever replaced whole.';

revoke execute on function public.apply_weekly_plan(uuid, date, date, jsonb) from public, anon, authenticated;
grant execute on function public.apply_weekly_plan(uuid, date, date, jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- Gathering two tasks the student already has into one learning task.
--
-- The plan tidier offers this for concept/Feynman pairs that were generated
-- before learning tasks existed. It is one statement's worth of work and three
-- statements' worth of ways to get it wrong, so it lives here: a container
-- without its steps would sit on the board as a card that means nothing, and a
-- half-applied group cannot be undone by the student.
--
-- Every condition is re-checked against the database rather than trusted from
-- the device: the tasks must be the caller's own, open, untouched, parentless,
-- childless, and about one topic.
-- ----------------------------------------------------------------------------
create or replace function public.group_learning_pair(
  p_child_ids uuid[],
  p_title     text,
  p_due_date  date
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user   uuid := auth.uid();
  v_topic  uuid;
  v_count  integer;
  v_topics integer;
  v_parent uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if coalesce(array_length(p_child_ids, 1), 0) < 2 then
    raise exception 'a learning task needs at least two steps' using errcode = '23514';
  end if;

  -- No min() for uuid; the first of the aggregate is enough once the distinct
  -- count below has proved there is only one topic.
  select count(*), count(distinct t.topic_id), (array_agg(t.topic_id))[1]
    into v_count, v_topics, v_topic
    from public.tasks t
   where t.id = any(p_child_ids)
     and t.user_id = v_user
     and t.parent_task_id is null
     and t.status in ('pending', 'in_progress')
     and t.completed_count = 0
     and not exists (select 1 from public.tasks c where c.parent_task_id = t.id);

  if v_count <> array_length(p_child_ids, 1) then
    raise exception 'tasks are not groupable' using errcode = '23514';
  end if;
  if v_topics <> 1 then
    raise exception 'tasks belong to different topics' using errcode = '23514';
  end if;

  insert into public.tasks
    (user_id, topic_id, type, title, instructions, target_count, estimated_minutes, due_date, source)
  values
    (v_user, v_topic, 'learning', left(p_title, 200),
     'Konsept sayfası ve Feynman anlatımı aynı oturum: önce sayfaya ekle, sonra kapat ve boş kâğıda anlat.',
     null, null, p_due_date, 'ai_weekly_plan')
  returning id into v_parent;

  update public.tasks
     set parent_task_id = v_parent
   where id = any(p_child_ids) and user_id = v_user;

  return v_parent;
end;
$$;

comment on function public.group_learning_pair(uuid[], text, date) is
  'Puts a topic''s concept and Feynman tasks under one learning task, in one transaction.';

revoke execute on function public.group_learning_pair(uuid[], text, date) from public, anon;
grant execute on function public.group_learning_pair(uuid[], text, date) to authenticated;
