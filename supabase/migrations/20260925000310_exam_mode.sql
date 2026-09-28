-- =============================================================================
-- Exam mode.
--
-- In the last week before an exam the ordinary weekly loop is the wrong shape:
-- what matters is which of the exam's topics are still weak, and what to do on
-- each of the remaining evenings. This adds
--   · a link from a task to the exam it was crammed for, so the sprint plan can
--     be replaced wholesale when it is regenerated
--   · the exam's own result, written afterwards by the student
--   · public.apply_exam_retro(), which turns "it went badly" into real
--     spaced-repetition state for the topics the exam covered
--
-- Spaced repetition is computed by the shared SM-2 module, not here: this
-- function applies and clamps, it does not invent schedules.
-- =============================================================================
alter table public.tasks
  add column origin_exam_id uuid,
  add constraint tasks_origin_exam_fk
    foreign key (origin_exam_id, user_id) references public.exams (id, user_id) on delete set null;

create index tasks_origin_exam_idx on public.tasks (origin_exam_id) where origin_exam_id is not null;

alter table public.exams
  add column outcome smallint check (outcome between 1 and 5),
  add column outcome_note text check (char_length(outcome_note) <= 500),
  add column reviewed_at timestamptz;

comment on column public.exams.outcome is
  'How the exam went, 1 (kötü) to 5 (çok iyi), stated by the student afterwards.';

-- ----------------------------------------------------------------------------
-- The sprint plan: replace this exam''s untouched cram tasks with a new set.
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
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select id, exam_date into v_exam from public.exams where id = p_exam_id and user_id = v_user;
  if not found then
    raise exception 'exam % not found', p_exam_id using errcode = 'P0002';
  end if;

  -- Only untouched cram tasks go: anything started, finished or annotated stays.
  with removed as (
    delete from public.tasks t
     where t.user_id = v_user
       and t.origin_exam_id = p_exam_id
       and t.source = 'exam_cram'
       and t.status = 'pending'
       and t.completed_count = 0
       and not exists (select 1 from public.task_notes n where n.task_id = t.id)
    returning 1
  )
  select count(*) into v_deleted from removed;

  with added as (
    insert into public.tasks
      (user_id, topic_id, type, title, instructions, target_count, estimated_minutes,
       due_date, source, origin_exam_id)
    select v_user, n.topic_id, n.type, n.title, n.instructions, n.target_count,
           n.estimated_minutes,
           least(greatest(n.due_date, current_date), v_exam.exam_date),
           'exam_cram'::public.task_source, p_exam_id
      from jsonb_to_recordset(p_tasks) as n(
             topic_id uuid, type public.task_type, title text, instructions text,
             target_count smallint, estimated_minutes smallint, due_date date)
      join public.topics tp on tp.id = n.topic_id and tp.user_id = v_user
    returning 1
  )
  select count(*) into v_inserted from added;

  return jsonb_build_object('deleted', v_deleted, 'inserted', v_inserted);
end;
$$;

revoke execute on function public.apply_exam_cram_plan(uuid, jsonb) from public, anon;
grant execute on function public.apply_exam_cram_plan(uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- The retro: the exam''s own verdict, pushed into the review schedule.
-- ----------------------------------------------------------------------------
create or replace function public.apply_exam_retro(
  p_exam_id  uuid,
  p_outcome  smallint,
  p_note     text,
  p_reviews  jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_updated integer := 0;
  v_closed  integer := 0;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome < 1 or p_outcome > 5 then
    raise exception 'outcome must be between 1 and 5' using errcode = '22023';
  end if;

  perform 1 from public.exams where id = p_exam_id and user_id = v_user;
  if not found then
    raise exception 'exam % not found', p_exam_id using errcode = 'P0002';
  end if;

  -- Values arrive computed; they are clamped here so a bad client cannot park a
  -- topic a decade into the future or drive the ease factor to zero.
  update public.topics tp
     set ease_factor      = least(3.00, greatest(1.30, r.ease_factor)),
         interval_days    = least(365, greatest(1, r.interval_days)),
         repetitions      = least(999, greatest(0, r.repetitions)),
         next_review_on   = least(current_date + 365, greatest(current_date, r.next_review_on)),
         last_reviewed_at = now()
    from jsonb_to_recordset(p_reviews) as r(
           topic_id uuid, ease_factor numeric, interval_days integer,
           repetitions integer, next_review_on date)
   where tp.id = r.topic_id
     and tp.user_id = v_user
     -- Only topics this exam actually covered.
     and exists (
       select 1 from public.exam_topics et
        where et.exam_id = p_exam_id and et.topic_id = tp.id and et.user_id = v_user
     );
  get diagnostics v_updated = row_count;

  -- The sprint is over: whatever is left of it is not work any more.
  with closed as (
    update public.tasks t
       set status = 'skipped'
     where t.user_id = v_user
       and t.origin_exam_id = p_exam_id
       and t.source = 'exam_cram'
       and t.status in ('pending', 'in_progress')
    returning 1
  )
  select count(*) into v_closed from closed;

  update public.exams
     set outcome      = p_outcome,
         outcome_note = left(p_note, 500),
         reviewed_at  = now()
   where id = p_exam_id and user_id = v_user;

  return jsonb_build_object('topics_updated', v_updated, 'tasks_closed', v_closed);
end;
$$;

revoke execute on function public.apply_exam_retro(uuid, smallint, text, jsonb) from public, anon;
grant execute on function public.apply_exam_retro(uuid, smallint, text, jsonb) to authenticated;
