-- =============================================================================
-- Taking a group apart, and saying what an exam covers.
--
-- "Gruplu görevleri dağıt" had no answer. A report could put tasks under one
-- card but never take them out again, and neither could the student by hand —
-- the only way back was undoing the whole check-in that grouped them, along
-- with everything else it did.
--
-- Ungrouping is order-sensitive in a way that is easy to get wrong:
-- tasks_parent_fk is ON DELETE CASCADE, so removing the container first would
-- take its steps with it — "dağıt" would become "sil". Steps leave first, then
-- the empty container goes: deleted with a snapshot when nothing was done on
-- it, set aside when something was, left alone when it is finished history.
--
-- "Vize 1 ilk beş haftayı kapsıyor" sets the exam's topics, which the exam
-- screen, "vize için plan çıkar" and "vizeden 65 aldım" all read. Before this
-- the report could name an exam but never say what was in it.
--
-- Both keep the undo contract: every change is written down before it is made,
-- and revert_daily_checkin plus its reverted_at triggers put it back.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Ungroup, from a report.
-- ----------------------------------------------------------------------------
create or replace function public.apply_checkin_ungroup(
  p_user_id      uuid,
  p_daily_log_id uuid,
  p_parent_ids   jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_log     record;
  v_freed   integer := 0;
  v_removed integer := 0;
  v_aside   integer := 0;
  v_parents uuid[];
begin
  select status, reverted_at into v_log
    from public.daily_logs
   where id = p_daily_log_id and user_id = p_user_id
     for update;

  if not found then
    raise exception 'daily_log % not found', p_daily_log_id using errcode = 'P0002';
  end if;
  if v_log.status <> 'succeeded' or v_log.reverted_at is not null then
    raise exception 'daily_log % is not an open, processed check-in', p_daily_log_id
      using errcode = '55000';
  end if;

  select coalesce(array_agg(distinct p.id), '{}') into v_parents
    from jsonb_array_elements_text(coalesce(p_parent_ids, '[]'::jsonb)) as x(value)
    join public.tasks p on p.id::text = x.value and p.user_id = p_user_id and p.parent_task_id is null;

  -- 1. Every step remembers its container — the undo reads it back from
  --    previous_fields, exactly as it does for a grouping — then leaves it.
  with steps as (
    select c.id, c.status, c.parent_task_id, c.completed_count, c.confidence_level, c.completed_at, c.correct_count
      from public.tasks c
     where c.parent_task_id = any (v_parents) and c.user_id = p_user_id
  ),
  audited as (
    insert into public.daily_log_task_updates as a
      (user_id, daily_log_id, task_id, previous_status, new_status, previous_fields,
       previous_completed_count, previous_confidence_level, previous_completed_at,
       previous_correct_count)
    select p_user_id, p_daily_log_id, s.id, s.status, s.status,
           jsonb_build_object('parent_task_id', to_jsonb(s.parent_task_id)),
           s.completed_count, s.confidence_level, s.completed_at, s.correct_count
      from steps s
    on conflict (daily_log_id, task_id) do update
      set previous_fields = coalesce(a.previous_fields, '{}'::jsonb) || excluded.previous_fields
    returning a.task_id
  )
  update public.tasks t
     set parent_task_id = null
    from steps s
   where t.id = s.id and t.user_id = p_user_id;
  get diagnostics v_freed = row_count;

  -- 2. The container, now empty. Untouched: deleted, with a snapshot the undo
  --    re-creates it from. Used: set aside. Finished: history, left alone.
  with shells as (
    select p.*
      from public.tasks p
     where p.id = any (v_parents) and p.user_id = p_user_id
       and p.status in ('pending', 'in_progress', 'failed')
       and not exists (select 1 from public.tasks c where c.parent_task_id = p.id)
  ),
  clean as (
    select s.* from shells s
     where s.completed_count = 0
       and not exists (select 1 from public.task_notes n where n.task_id = s.id)
       and not exists (select 1 from public.task_sessions ts where ts.task_id = s.id)
  ),
  snapshotted as (
    insert into public.daily_log_task_deletions (user_id, daily_log_id, task_id, snapshot, reason)
    select p_user_id, p_daily_log_id, c.id, to_jsonb(c), 'Grup dağıtıldı'
      from clean c
    on conflict (daily_log_id, task_id) do nothing
    returning task_id
  ),
  deleted as (
    delete from public.tasks t
     using snapshotted s
     where t.id = s.task_id and t.user_id = p_user_id
    returning t.id
  )
  select count(*) into v_removed from deleted;

  with used as (
    select p.*
      from public.tasks p
     where p.id = any (v_parents) and p.user_id = p_user_id
       and p.status in ('pending', 'in_progress', 'failed')
       and not exists (select 1 from public.tasks c where c.parent_task_id = p.id)
  ),
  audited as (
    insert into public.daily_log_task_updates
      (user_id, daily_log_id, task_id, previous_status, new_status, note,
       previous_completed_count, previous_confidence_level, previous_completed_at,
       previous_correct_count)
    select p_user_id, p_daily_log_id, u.id, u.status, 'skipped', 'Grup dağıtıldı',
           u.completed_count, u.confidence_level, u.completed_at, u.correct_count
      from used u
    on conflict (daily_log_id, task_id) do nothing
    returning task_id
  )
  update public.tasks t
     set status = 'skipped'
    from audited a
   where t.id = a.task_id and t.user_id = p_user_id;
  get diagnostics v_aside = row_count;

  return jsonb_build_object('freed', v_freed, 'removed', v_removed, 'set_aside', v_aside);
end;
$$;

comment on function public.apply_checkin_ungroup(uuid, uuid, jsonb) is
  'Takes the steps out of the given containers, then removes the empty containers; undone with the check-in.';

revoke execute on function public.apply_checkin_ungroup(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_checkin_ungroup(uuid, uuid, jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- Ungroup, by hand ("Grubu dağıt" on the task screen). The same rules, for the
-- signed-in student, in one transaction.
-- ----------------------------------------------------------------------------
create or replace function public.ungroup_task(p_parent_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_parent  record;
  v_freed   integer := 0;
  v_outcome text := 'kept';
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select id, status, completed_count into v_parent
    from public.tasks
   where id = p_parent_id and user_id = v_user and parent_task_id is null
     for update;
  if not found then
    raise exception 'task % not found', p_parent_id using errcode = 'P0002';
  end if;

  update public.tasks set parent_task_id = null
   where parent_task_id = p_parent_id and user_id = v_user;
  get diagnostics v_freed = row_count;

  if v_freed > 0 and v_parent.status in ('pending', 'in_progress', 'failed') then
    if v_parent.completed_count = 0
       and not exists (select 1 from public.task_notes n where n.task_id = p_parent_id)
       and not exists (select 1 from public.task_sessions s where s.task_id = p_parent_id) then
      delete from public.tasks where id = p_parent_id and user_id = v_user;
      v_outcome := 'removed';
    else
      update public.tasks set status = 'skipped' where id = p_parent_id and user_id = v_user;
      v_outcome := 'set_aside';
    end if;
  end if;

  return jsonb_build_object('freed', v_freed, 'container', v_outcome);
end;
$$;

comment on function public.ungroup_task(uuid) is
  'Takes every step out of a task the student owns and removes the empty container.';

revoke execute on function public.ungroup_task(uuid) from public, anon;
grant execute on function public.ungroup_task(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- What an exam covers, from a report.
-- ----------------------------------------------------------------------------
alter table public.daily_log_extras
  drop constraint daily_log_extras_kind_check,
  add constraint daily_log_extras_kind_check
    check (kind in ('extra_work', 'exam_result', 'priority', 'exam_topics'));

create or replace function public.apply_checkin_exam_scopes(
  p_user_id      uuid,
  p_daily_log_id uuid,
  p_scopes       jsonb default '[]'::jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_log     record;
  v_scope   record;
  v_changed integer := 0;
begin
  select status, reverted_at into v_log
    from public.daily_logs
   where id = p_daily_log_id and user_id = p_user_id
     for update;

  if not found then
    raise exception 'daily_log % not found', p_daily_log_id using errcode = 'P0002';
  end if;
  if v_log.status <> 'succeeded' or v_log.reverted_at is not null then
    raise exception 'daily_log % is not an open, processed check-in', p_daily_log_id
      using errcode = '55000';
  end if;

  for v_scope in
    select distinct on (s.exam_id) s.exam_id, s.topic_ids, coalesce(s.replace, false) as replace
      from jsonb_to_recordset(coalesce(p_scopes, '[]'::jsonb)) as s(exam_id uuid, topic_ids jsonb, replace boolean)
      join public.exams e on e.id = s.exam_id and e.user_id = p_user_id
  loop
    -- The list as it was, once per exam and check-in: the undo puts it back whole.
    insert into public.daily_log_extras (user_id, daily_log_id, kind, target_id, previous)
    select p_user_id, p_daily_log_id, 'exam_topics', v_scope.exam_id,
           coalesce((select jsonb_agg(et.topic_id) from public.exam_topics et
                      where et.exam_id = v_scope.exam_id and et.user_id = p_user_id), '[]'::jsonb)
     where not exists (
       select 1 from public.daily_log_extras x
        where x.daily_log_id = p_daily_log_id and x.kind = 'exam_topics' and x.target_id = v_scope.exam_id
     );

    if v_scope.replace then
      delete from public.exam_topics et
       where et.exam_id = v_scope.exam_id and et.user_id = p_user_id
         and et.topic_id::text not in (select jsonb_array_elements_text(coalesce(v_scope.topic_ids, '[]'::jsonb)));
    end if;

    insert into public.exam_topics (exam_id, topic_id, user_id)
    select v_scope.exam_id, tp.id, p_user_id
      from jsonb_array_elements_text(coalesce(v_scope.topic_ids, '[]'::jsonb)) as t(value)
      join public.topics tp on tp.id::text = t.value and tp.user_id = p_user_id
    on conflict (exam_id, topic_id) do nothing;

    v_changed := v_changed + 1;
  end loop;

  return v_changed;
end;
$$;

comment on function public.apply_checkin_exam_scopes(uuid, uuid, jsonb) is
  'Sets the topics an exam covers from a report; the previous list is kept for the undo.';

revoke execute on function public.apply_checkin_exam_scopes(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_checkin_exam_scopes(uuid, uuid, jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- Undo: the extras trigger learns to put an exam's topic list back.
-- ----------------------------------------------------------------------------
create or replace function public.undo_checkin_extras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.tasks t
   using public.daily_log_extras x
   where x.daily_log_id = new.id and x.user_id = new.user_id and x.kind = 'extra_work'
     and t.id = x.target_id and t.user_id = new.user_id;

  update public.exams e
     set outcome      = (x.previous ->> 'outcome')::smallint,
         outcome_note = x.previous ->> 'outcome_note',
         reviewed_at  = (x.previous ->> 'reviewed_at')::timestamptz
    from public.daily_log_extras x
   where x.daily_log_id = new.id and x.user_id = new.user_id and x.kind = 'exam_result'
     and e.id = x.target_id and e.user_id = new.user_id;

  update public.tasks t
     set is_priority = coalesce((x.previous ->> 'is_priority')::boolean, false)
    from public.daily_log_extras x
   where x.daily_log_id = new.id and x.user_id = new.user_id and x.kind = 'priority'
     and t.id = x.target_id and t.user_id = new.user_id;

  -- An exam's topic list: exactly what it held before, no more and no less.
  delete from public.exam_topics et
   using public.daily_log_extras x
   where x.daily_log_id = new.id and x.user_id = new.user_id and x.kind = 'exam_topics'
     and et.exam_id = x.target_id and et.user_id = new.user_id;

  insert into public.exam_topics (exam_id, topic_id, user_id)
  select x.target_id, tp.id, new.user_id
    from public.daily_log_extras x
    cross join lateral jsonb_array_elements_text(coalesce(x.previous, '[]'::jsonb)) as t(value)
    join public.topics tp on tp.id::text = t.value and tp.user_id = new.user_id
   where x.daily_log_id = new.id and x.user_id = new.user_id and x.kind = 'exam_topics'
  on conflict (exam_id, topic_id) do nothing;

  return new;
end;
$$;
