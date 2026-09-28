-- =============================================================================
-- The check-in gets the same authority the student has.
--
-- Everything the app lets them change by hand — a task's title, its
-- instructions, its type, how many questions it holds, how long it should
-- take, the day its window opens, how its minutes are spread over the week,
-- which tasks hang together as one piece of work, the notes on a task, the
-- time logged against it, the exams on the calendar, the entries in the
-- mistake book — could only be changed by hand. Writing "bunu 20 soruya
-- indir", "şu üçünü tek ödev olarak grupla", "vize 5 aralığa ertelendi" in a
-- report did nothing at all, so the student had to go and do it themselves,
-- which is the one thing the report was supposed to save them.
--
-- Two things stay out, and both on purpose: the LLM model and the API key
-- (the student's own decision, never the model's), and the due date of a
-- task, which moving work between days already owns.
--
-- Every change is written down before it is made, so "geri al" still means
-- what it says. The undo hooks onto `reverted_at` rather than into
-- revert_daily_checkin: restoring these fields has to happen after that
-- function has finished deleting and re-creating rows, or it would be
-- restoring tasks that are about to be replaced.
-- =============================================================================

-- The task fields this check-in changed, as they were before it ran. Only the
-- whitelist below is ever stored, and a row that changed nothing keeps null.
alter table public.daily_log_task_updates
  add column previous_fields jsonb;

comment on column public.daily_log_task_updates.previous_fields is
  'Pre-check-in values of the editable task fields (title, instructions, type, target_count, estimated_minutes, starts_on, day_allocations, parent_task_id). Null unless this check-in edited the task.';

-- Notes and logged time carry the check-in that wrote them, so the undo can
-- take back exactly what it added and nothing the student wrote themselves.
alter table public.task_notes
  add column source_daily_log_id uuid,
  add constraint task_notes_source_log_fk
    foreign key (source_daily_log_id, user_id) references public.daily_logs (id, user_id)
    on delete set null (source_daily_log_id);

alter table public.task_sessions
  add column source_daily_log_id uuid,
  add constraint task_sessions_source_log_fk
    foreign key (source_daily_log_id, user_id) references public.daily_logs (id, user_id)
    on delete set null (source_daily_log_id);

-- A book entry the student closed by saying so in a report: the undo reopens
-- it, while one they ticked off by hand stays closed.
alter table public.topic_mistakes
  add column resolved_by_daily_log_id uuid,
  add constraint topic_mistakes_resolved_by_fk
    foreign key (resolved_by_daily_log_id, user_id) references public.daily_logs (id, user_id)
    on delete set null (resolved_by_daily_log_id);

create index task_notes_source_log_idx on public.task_notes (source_daily_log_id)
  where source_daily_log_id is not null;
create index task_sessions_source_log_idx on public.task_sessions (source_daily_log_id)
  where source_daily_log_id is not null;

-- Exams live outside the task tree, so their history needs its own table.
create table public.daily_log_exam_changes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  daily_log_id  uuid not null,
  exam_id       uuid not null,
  action        text not null check (action in ('insert', 'update', 'delete')),
  /** The row as it was; null for an insert, which had no "before". */
  previous      jsonb,
  created_at    timestamptz not null default now(),

  constraint daily_log_exam_changes_log_fk
    foreign key (daily_log_id, user_id) references public.daily_logs (id, user_id)
    on delete cascade
);

create index daily_log_exam_changes_log_idx on public.daily_log_exam_changes (daily_log_id);

alter table public.daily_log_exam_changes enable row level security;

create policy "daily_log_exam_changes_select_own" on public.daily_log_exam_changes
  for select to authenticated using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Apply. Runs straight after apply_daily_checkin, on the same log, and only
-- while that log is still the successful, un-reverted one it just closed.
-- ----------------------------------------------------------------------------
create or replace function public.apply_checkin_edits(
  p_user_id             uuid,
  p_daily_log_id        uuid,
  p_task_edits          jsonb default '[]'::jsonb,
  p_task_groups         jsonb default '[]'::jsonb,
  p_task_notes          jsonb default '[]'::jsonb,
  p_time_logs           jsonb default '[]'::jsonb,
  p_exam_changes        jsonb default '[]'::jsonb,
  p_mistake_resolutions jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_log        record;
  v_edited     integer := 0;
  v_grouped    integer := 0;
  v_noted      integer := 0;
  v_logged     integer := 0;
  v_exams      integer := 0;
  v_resolved   integer := 0;
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

  -- 1. Field edits. The request carries only the keys it wants changed, and
  --    the snapshot carries the same keys as they were: the undo needs no
  --    knowledge of which field meant what.
  with request as (
    select (x ->> 'task_id')::uuid as task_id,
           coalesce(x -> 'fields', '{}'::jsonb) as fields
      from jsonb_array_elements(coalesce(p_task_edits, '[]'::jsonb)) as x
     where x ? 'task_id'
  ),
  target as (
    select t.id,
           r.fields,
           jsonb_build_object(
             'title',             to_jsonb(t.title),
             'instructions',      to_jsonb(t.instructions),
             'type',              to_jsonb(t.type::text),
             'target_count',      to_jsonb(t.target_count),
             'estimated_minutes', to_jsonb(t.estimated_minutes),
             'starts_on',         to_jsonb(t.starts_on),
             'day_allocations',   coalesce(t.day_allocations, 'null'::jsonb)
           ) as snapshot,
           t.status, t.completed_count, t.confidence_level, t.completed_at, t.correct_count
      from request r
      join public.tasks t on t.id = r.task_id and t.user_id = p_user_id
  ),
  audited as (
    insert into public.daily_log_task_updates as a
      (user_id, daily_log_id, task_id, previous_status, new_status, previous_fields,
       previous_completed_count, previous_confidence_level, previous_completed_at,
       previous_correct_count)
    select p_user_id, p_daily_log_id, g.id, g.status, g.status, g.snapshot,
           g.completed_count, g.confidence_level, g.completed_at, g.correct_count
      from target g
    on conflict (daily_log_id, task_id) do update
      set previous_fields = coalesce(a.previous_fields, excluded.previous_fields)
    returning a.task_id
  ),
  applied as (
    update public.tasks t
       set title = case when g.fields ? 'title'
                        then left(g.fields ->> 'title', 200) else t.title end,
           instructions = case when g.fields ? 'instructions'
                               then left(g.fields ->> 'instructions', 2000) else t.instructions end,
           type = case when g.fields ? 'type'
                       then (g.fields ->> 'type')::public.task_type else t.type end,
           target_count = case when g.fields ? 'target_count'
                               then (g.fields ->> 'target_count')::smallint else t.target_count end,
           estimated_minutes = case when g.fields ? 'estimated_minutes'
                                    then (g.fields ->> 'estimated_minutes')::smallint
                                    else t.estimated_minutes end,
           starts_on = case when g.fields ? 'starts_on'
                            then (g.fields ->> 'starts_on')::date else t.starts_on end,
           day_allocations = case
                               when not (g.fields ? 'day_allocations') then t.day_allocations
                               when g.fields -> 'day_allocations' = 'null'::jsonb then null
                               else g.fields -> 'day_allocations'
                             end
      from target g
     where t.id = g.id and t.user_id = p_user_id
    returning t.id
  )
  select count(*) into v_edited from applied;

  -- 2. Grouping. A task only becomes a step of another when the shape stays
  --    one level deep and neither row is the other's ancestor; anything else
  --    is dropped rather than raised, so one bad pair cannot lose a report.
  with request as (
    select (x ->> 'parent_task_id')::uuid as parent_id,
           child::uuid as child_id
      from jsonb_array_elements(coalesce(p_task_groups, '[]'::jsonb)) as x
      cross join lateral jsonb_array_elements_text(coalesce(x -> 'child_task_ids', '[]'::jsonb)) as child
  ),
  valid as (
    select distinct r.parent_id, c.id as child_id,
           jsonb_build_object('parent_task_id', to_jsonb(c.parent_task_id)) as snapshot,
           c.status, c.completed_count, c.confidence_level, c.completed_at, c.correct_count
      from request r
      join public.tasks p on p.id = r.parent_id and p.user_id = p_user_id and p.parent_task_id is null
      join public.tasks c on c.id = r.child_id and c.user_id = p_user_id
     where c.id <> p.id
       and c.parent_task_id is distinct from p.id
       and not exists (select 1 from public.tasks g where g.parent_task_id = c.id)
  ),
  audited as (
    insert into public.daily_log_task_updates as a
      (user_id, daily_log_id, task_id, previous_status, new_status, previous_fields,
       previous_completed_count, previous_confidence_level, previous_completed_at,
       previous_correct_count)
    select p_user_id, p_daily_log_id, v.child_id, v.status, v.status, v.snapshot,
           v.completed_count, v.confidence_level, v.completed_at, v.correct_count
      from valid v
    on conflict (daily_log_id, task_id) do update
      set previous_fields = coalesce(a.previous_fields, '{}'::jsonb) || excluded.previous_fields
    returning a.task_id
  ),
  attached as (
    update public.tasks t
       set parent_task_id = v.parent_id
      from valid v
     where t.id = v.child_id and t.user_id = p_user_id
    returning t.id
  )
  select count(*) into v_grouped from attached;

  -- 3. Notes the report dictates for a task.
  with added as (
    insert into public.task_notes (user_id, task_id, body, source_daily_log_id)
    select p_user_id, t.id, left(n.body, 2000), p_daily_log_id
      from jsonb_to_recordset(coalesce(p_task_notes, '[]'::jsonb)) as n(task_id uuid, body text)
      join public.tasks t on t.id = n.task_id and t.user_id = p_user_id
     where char_length(trim(coalesce(n.body, ''))) > 0
    returning id
  )
  select count(*) into v_noted from added;

  -- 4. Time the student says they spent. Stored as a closed session on the day
  --    it happened, exactly like a session logged by hand.
  with added as (
    insert into public.task_sessions (user_id, task_id, started_at, ended_at, minutes, source_daily_log_id)
    select p_user_id, t.id,
           (l.on_date + time '12:00')::timestamptz,
           (l.on_date + time '12:00')::timestamptz + make_interval(mins => l.minutes),
           l.minutes, p_daily_log_id
      from jsonb_to_recordset(coalesce(p_time_logs, '[]'::jsonb))
             as l(task_id uuid, minutes smallint, on_date date)
      join public.tasks t on t.id = l.task_id and t.user_id = p_user_id
     where l.minutes between 1 and 1440 and l.on_date is not null
    returning id
  )
  select count(*) into v_logged from added;

  -- 5. Exams: added, moved or called off. Each one keeps the row it replaced.
  with request as (
    select x ->> 'action' as action,
           (x ->> 'exam_id')::uuid as exam_id,
           (x ->> 'course_id')::uuid as course_id,
           x ->> 'title' as title,
           x ->> 'kind' as kind,
           (x ->> 'exam_date')::date as exam_date
      from jsonb_array_elements(coalesce(p_exam_changes, '[]'::jsonb)) as x
  ),
  before as (
    select r.action, e.id, to_jsonb(e) as snapshot
      from request r
      join public.exams e on e.id = r.exam_id and e.user_id = p_user_id
  ),
  deleted as (
    delete from public.exams e
     using request r
     where r.action = 'delete' and e.id = r.exam_id and e.user_id = p_user_id
    returning e.id
  ),
  updated as (
    update public.exams e
       set title     = coalesce(left(r.title, 120), e.title),
           kind      = coalesce(r.kind::public.exam_kind, e.kind),
           exam_date = coalesce(r.exam_date, e.exam_date)
      from request r
     where r.action = 'update' and e.id = r.exam_id and e.user_id = p_user_id
    returning e.id
  ),
  inserted as (
    insert into public.exams (user_id, course_id, kind, title, exam_date)
    select p_user_id, c.id, coalesce(r.kind, 'other')::public.exam_kind,
           left(coalesce(r.title, 'Sınav'), 120), r.exam_date
      from request r
      join public.courses c on c.id = r.course_id and c.user_id = p_user_id
     where r.action = 'insert' and r.exam_date is not null
    returning id
  ),
  audited as (
    insert into public.daily_log_exam_changes (user_id, daily_log_id, exam_id, action, previous)
    select p_user_id, p_daily_log_id, b.id, b.action, b.snapshot
      from before b
     where b.action in ('delete', 'update')
       and (b.id in (select id from deleted) or b.id in (select id from updated))
    union all
    select p_user_id, p_daily_log_id, i.id, 'insert', null from inserted i
    returning exam_id
  )
  select count(*) into v_exams from audited;

  -- 6. Book entries the student says they have now.
  with closed as (
    update public.topic_mistakes m
       set resolved_at = now(),
           resolved_by_daily_log_id = p_daily_log_id
      from jsonb_to_recordset(coalesce(p_mistake_resolutions, '[]'::jsonb)) as r(mistake_id uuid)
     where m.id = r.mistake_id and m.user_id = p_user_id and m.resolved_at is null
    returning m.id
  )
  select count(*) into v_resolved from closed;

  return jsonb_build_object(
    'edited', v_edited, 'grouped', v_grouped, 'noted', v_noted,
    'logged', v_logged, 'exams', v_exams, 'resolved', v_resolved
  );
end;
$$;

comment on function public.apply_checkin_edits(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) is
  'Applies the edits a report asks for — task fields, grouping, notes, logged time, exams, mistake-book entries — recording the previous values so the check-in can still be undone.';

revoke execute on function public.apply_checkin_edits(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_checkin_edits(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)
  to service_role;

-- ----------------------------------------------------------------------------
-- Undo. Hooked onto the moment a log is marked reverted rather than written
-- into revert_daily_checkin: by then that function has finished deleting the
-- work it created and restoring the work it removed, so these fields are the
-- last thing to put back and nothing overwrites them afterwards.
-- ----------------------------------------------------------------------------
create or replace function public.restore_checkin_edits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 1. Every edited field, back to the value the snapshot holds. A key that is
  --    absent was never touched; a key holding JSON null was null before.
  update public.tasks t
     set title = case when a.previous_fields ? 'title'
                      then coalesce(a.previous_fields ->> 'title', t.title) else t.title end,
         instructions = case when a.previous_fields ? 'instructions'
                             then a.previous_fields ->> 'instructions' else t.instructions end,
         type = case when a.previous_fields ? 'type'
                     then (a.previous_fields ->> 'type')::public.task_type else t.type end,
         target_count = case when a.previous_fields ? 'target_count'
                             then (a.previous_fields ->> 'target_count')::smallint
                             else t.target_count end,
         estimated_minutes = case when a.previous_fields ? 'estimated_minutes'
                                  then (a.previous_fields ->> 'estimated_minutes')::smallint
                                  else t.estimated_minutes end,
         starts_on = case when a.previous_fields ? 'starts_on'
                          then (a.previous_fields ->> 'starts_on')::date else t.starts_on end,
         day_allocations = case
                             when not (a.previous_fields ? 'day_allocations') then t.day_allocations
                             when a.previous_fields -> 'day_allocations' = 'null'::jsonb then null
                             else a.previous_fields -> 'day_allocations'
                           end,
         parent_task_id = case when a.previous_fields ? 'parent_task_id'
                               then (a.previous_fields ->> 'parent_task_id')::uuid
                               else t.parent_task_id end
    from public.daily_log_task_updates a
   where a.daily_log_id = new.id
     and a.user_id = new.user_id
     and a.previous_fields is not null
     and t.id = a.task_id
     and t.user_id = new.user_id;

  -- 2. Notes and time this check-in added. Anything the student wrote or timed
  --    themselves carries no source log and is left alone.
  delete from public.task_notes
   where source_daily_log_id = new.id and user_id = new.user_id;

  delete from public.task_sessions
   where source_daily_log_id = new.id and user_id = new.user_id;

  -- 3. Book entries it closed are open again; ones ticked off by hand stay shut.
  update public.topic_mistakes
     set resolved_at = null, resolved_by_daily_log_id = null
   where resolved_by_daily_log_id = new.id and user_id = new.user_id;

  -- 4. Exams, in the order that keeps the calendar consistent: take back what
  --    it added, then put back what it changed or called off.
  delete from public.exams e
   using public.daily_log_exam_changes c
   where c.daily_log_id = new.id and c.user_id = new.user_id
     and c.action = 'insert' and e.id = c.exam_id and e.user_id = new.user_id;

  update public.exams e
     set course_id      = (c.previous ->> 'course_id')::uuid,
         kind           = (c.previous ->> 'kind')::public.exam_kind,
         title          = c.previous ->> 'title',
         exam_date      = (c.previous ->> 'exam_date')::date,
         start_time     = (c.previous ->> 'start_time')::time,
         weight_percent = (c.previous ->> 'weight_percent')::numeric
    from public.daily_log_exam_changes c
   where c.daily_log_id = new.id and c.user_id = new.user_id
     and c.action = 'update' and e.id = c.exam_id and e.user_id = new.user_id;

  insert into public.exams
    (id, user_id, course_id, kind, title, exam_date, start_time, weight_percent, created_at)
  select (c.previous ->> 'id')::uuid, new.user_id, (c.previous ->> 'course_id')::uuid,
         (c.previous ->> 'kind')::public.exam_kind, c.previous ->> 'title',
         (c.previous ->> 'exam_date')::date, (c.previous ->> 'start_time')::time,
         (c.previous ->> 'weight_percent')::numeric,
         coalesce((c.previous ->> 'created_at')::timestamptz, now())
    from public.daily_log_exam_changes c
   where c.daily_log_id = new.id and c.user_id = new.user_id
     and c.action = 'delete'
     -- The course may have gone in the meantime; an exam cannot outlive it.
     and exists (
       select 1 from public.courses co
        where co.id = (c.previous ->> 'course_id')::uuid and co.user_id = new.user_id
     )
  on conflict (id) do nothing;

  -- 5. A container this check-in created to group existing work is empty now
  --    that its steps have been handed back. revert_daily_checkin could not
  --    remove it while it still sheltered them, so it goes here — and only if
  --    it is still untouched, which is the same test that function applies.
  delete from public.tasks t
   where t.user_id = new.user_id
     and t.origin_daily_log_id = new.id
     and t.status = 'pending'
     and t.completed_count = 0
     and not exists (select 1 from public.tasks c where c.parent_task_id = t.id)
     and not exists (select 1 from public.task_notes n where n.task_id = t.id)
     and not exists (select 1 from public.task_sessions s where s.task_id = t.id);

  return new;
end;
$$;

comment on function public.restore_checkin_edits() is
  'Undoes the edits apply_checkin_edits made, once revert_daily_checkin has marked the log reverted.';

create trigger daily_logs_restore_checkin_edits
  after update of reverted_at on public.daily_logs
  for each row
  when (old.reverted_at is null and new.reverted_at is not null)
  execute function public.restore_checkin_edits();
