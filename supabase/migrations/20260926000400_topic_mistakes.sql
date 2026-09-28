-- =============================================================================
-- The mistake book.
--
-- "Carnot verimini karıştırdım" is the most valuable sentence in a check-in
-- and, until now, the least used one: it became a note on a task that was
-- about to be closed, and disappeared. What a student got wrong last time is
-- exactly what they should read before they meet the topic again.
-- =============================================================================
create table public.topic_mistakes (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles (id) on delete cascade,
  topic_id             uuid not null,
  body                 text not null check (char_length(body) between 2 and 300),
  /** The check-in that recorded it, so an undo can take it back. */
  source_daily_log_id  uuid,
  task_id              uuid,
  created_at           timestamptz not null default now(),
  /** Set when the student says they have this one now. */
  resolved_at          timestamptz,

  constraint topic_mistakes_id_user_key unique (id, user_id),
  constraint topic_mistakes_topic_fk
    foreign key (topic_id, user_id) references public.topics (id, user_id) on delete cascade,
  constraint topic_mistakes_log_fk
    foreign key (source_daily_log_id, user_id) references public.daily_logs (id, user_id)
    on delete set null (source_daily_log_id),
  constraint topic_mistakes_task_fk
    foreign key (task_id, user_id) references public.tasks (id, user_id)
    on delete set null (task_id)
);

create index topic_mistakes_topic_idx on public.topic_mistakes (topic_id, created_at desc);
create index topic_mistakes_open_idx on public.topic_mistakes (user_id, topic_id) where resolved_at is null;

alter table public.topic_mistakes enable row level security;

create policy "topic_mistakes_select_own" on public.topic_mistakes
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "topic_mistakes_insert_own" on public.topic_mistakes
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "topic_mistakes_update_own" on public.topic_mistakes
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "topic_mistakes_delete_own" on public.topic_mistakes
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- The check-in writes them; the undo takes them back.
-- ----------------------------------------------------------------------------
create or replace function public.apply_checkin_mistakes(
  p_user_id       uuid,
  p_daily_log_id  uuid,
  p_mistakes      jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_added integer := 0;
begin
  with candidate as (
    select distinct on (m.topic_id, lower(btrim(m.body)))
           m.topic_id, btrim(m.body) as body, m.task_id
      from jsonb_to_recordset(coalesce(p_mistakes, '[]'::jsonb)) as m(topic_id uuid, body text, task_id uuid)
     where btrim(coalesce(m.body, '')) <> ''
  ),
  added as (
    insert into public.topic_mistakes (user_id, topic_id, body, source_daily_log_id, task_id)
    select p_user_id, c.topic_id, left(c.body, 300), p_daily_log_id, c.task_id
      from candidate c
      join public.topics t on t.id = c.topic_id and t.user_id = p_user_id
     -- The same slip, still unresolved, is not news.
     where not exists (
       select 1 from public.topic_mistakes existing
        where existing.user_id = p_user_id
          and existing.topic_id = c.topic_id
          and existing.resolved_at is null
          and lower(existing.body) = lower(left(c.body, 300))
     )
    returning 1
  )
  select count(*) into v_added from added;

  return v_added;
end;
$$;

revoke execute on function public.apply_checkin_mistakes(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_checkin_mistakes(uuid, uuid, jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- Undo also takes back the mistakes this check-in wrote down.
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

  with restored as (
    insert into public.tasks
      (id, user_id, topic_id, type, title, instructions, target_count, completed_count,
       correct_count, estimated_minutes, due_date, starts_on, status, confidence_level, source,
       rescheduled_from_task_id, origin_daily_log_id, origin_exam_id, completed_at, created_at)
    select (d.snapshot ->> 'id')::uuid,
           v_user,
           (d.snapshot ->> 'topic_id')::uuid,
           (d.snapshot ->> 'type')::public.task_type,
           d.snapshot ->> 'title',
           d.snapshot ->> 'instructions',
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
    on conflict (id) do nothing
    returning 1
  )
  select count(*) into v_tasks_recreated from restored;

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


  -- Mistakes this check-in recorded go with it.
  delete from public.topic_mistakes
   where user_id = v_user and source_daily_log_id = p_daily_log_id;

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
