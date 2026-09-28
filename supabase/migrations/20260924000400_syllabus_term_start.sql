-- apply_syllabus_ingestion learns about term_start_date, so an exam given only
-- as "8. hafta" can be placed on the calendar.
create or replace function public.apply_syllabus_ingestion(
  p_user_id   uuid,
  p_upload_id uuid,
  p_llm_model text,
  p_payload   jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status         public.processing_status;
  v_course_id      uuid;
  v_course         jsonb := p_payload -> 'course';
  v_topics_added   integer := 0;
  v_exams_added    integer := 0;
  v_links_added    integer := 0;
begin
  select status into v_status
    from public.syllabus_uploads
   where id = p_upload_id and user_id = p_user_id
     for update;

  if not found then
    raise exception 'syllabus_upload % not found', p_upload_id using errcode = 'P0002';
  end if;
  if v_status <> 'processing' then
    raise exception 'syllabus_upload % is %, expected processing', p_upload_id, v_status
      using errcode = '55000';
  end if;

  -- 1. Course: reuse the user's existing course with the same name.
  select id into v_course_id
    from public.courses
   where user_id = p_user_id and lower(name) = lower(v_course ->> 'name');

  if v_course_id is null then
    insert into public.courses (user_id, name, code, color_hex, term_start_date)
    values (p_user_id, v_course ->> 'name', v_course ->> 'code', v_course ->> 'color_hex',
            (v_course ->> 'term_start_date')::date)
    returning id into v_course_id;
  else
    update public.courses
       set code            = coalesce(v_course ->> 'code', code),
           color_hex       = coalesce(v_course ->> 'color_hex', color_hex),
           term_start_date = coalesce((v_course ->> 'term_start_date')::date, term_start_date)
     where id = v_course_id;
  end if;

  -- 2. Topics: add only titles this course does not already have.
  with incoming as (
    select t.title, t.week_number, t.position
      from jsonb_to_recordset(coalesce(p_payload -> 'topics', '[]'::jsonb))
        as t(title text, week_number smallint, position smallint)
  ), inserted as (
    insert into public.topics (user_id, course_id, title, week_number, position)
    select p_user_id, v_course_id, i.title, i.week_number, i.position
      from incoming i
     where not exists (
       select 1 from public.topics existing
        where existing.course_id = v_course_id and lower(existing.title) = lower(i.title)
     )
    on conflict (course_id, week_number, position) do nothing
    returning 1
  )
  select count(*) into v_topics_added from inserted;

  -- 3. Exams: keyed by (title, date) so re-ingesting is a no-op.
  with incoming as (
    select e.kind, e.title, e.exam_date, e.start_time, e.weight_percent
      from jsonb_to_recordset(coalesce(p_payload -> 'exams', '[]'::jsonb))
        as e(kind public.exam_kind, title text, exam_date date, start_time time, weight_percent numeric)
  ), inserted as (
    insert into public.exams (user_id, course_id, kind, title, exam_date, start_time, weight_percent)
    select p_user_id, v_course_id, i.kind, i.title, i.exam_date, i.start_time, i.weight_percent
      from incoming i
     where not exists (
       select 1 from public.exams existing
        where existing.course_id = v_course_id
          and lower(existing.title) = lower(i.title)
          and existing.exam_date = i.exam_date
     )
    returning 1
  )
  select count(*) into v_exams_added from inserted;

  -- 4. Link each exam to the topics of the weeks it covers.
  with incoming as (
    select e.title, e.exam_date, e.topic_weeks
      from jsonb_to_recordset(coalesce(p_payload -> 'exams', '[]'::jsonb))
        as e(title text, exam_date date, topic_weeks jsonb)
  ), pairs as (
    select ex.id as exam_id, tp.id as topic_id
      from incoming i
      join public.exams ex
        on ex.course_id = v_course_id and lower(ex.title) = lower(i.title) and ex.exam_date = i.exam_date
      join lateral jsonb_array_elements_text(coalesce(i.topic_weeks, '[]'::jsonb)) as w(week) on true
      join public.topics tp
        on tp.course_id = v_course_id and tp.week_number = w.week::smallint
  ), linked as (
    insert into public.exam_topics (exam_id, topic_id, user_id)
    select distinct p.exam_id, p.topic_id, p_user_id from pairs p
    on conflict (exam_id, topic_id) do nothing
    returning 1
  )
  select count(*) into v_links_added from linked;

  -- 5. Close the upload.
  update public.syllabus_uploads
     set status        = 'succeeded',
         course_id     = v_course_id,
         llm_model     = p_llm_model,
         error_message = null,
         processed_at  = now()
   where id = p_upload_id;

  return jsonb_build_object(
    'course_id', v_course_id,
    'topics_added', v_topics_added,
    'exams_added', v_exams_added,
    'exam_topic_links_added', v_links_added
  );
end;
$$;
