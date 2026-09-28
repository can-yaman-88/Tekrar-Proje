-- =============================================================================
-- Check-in attachments: PDFs and photos the student adds to a daily report.
-- The Edge Function reads them (PDF text extraction, images as vision input)
-- and may create tasks from them, e.g. from a homework sheet.
-- =============================================================================
create table public.daily_log_attachments (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  daily_log_id       uuid not null,
  storage_path       text not null unique,
  original_filename  text not null check (char_length(original_filename) between 1 and 255),
  mime_type          text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes         integer not null check (size_bytes > 0 and size_bytes <= 10485760),  -- 10 MB
  created_at         timestamptz not null default now(),

  constraint daily_log_attachments_id_user_key unique (id, user_id),
  constraint daily_log_attachments_log_fk
    foreign key (daily_log_id, user_id) references public.daily_logs (id, user_id)
    on delete cascade,
  constraint daily_log_attachments_path_owned
    check (storage_path like user_id::text || '/%')
);

create index daily_log_attachments_log_idx on public.daily_log_attachments (daily_log_id);
create index daily_log_attachments_user_idx on public.daily_log_attachments (user_id);

alter table public.daily_log_attachments enable row level security;

-- The client uploads and may delete before submitting; processing reads them.
create policy "daily_log_attachments_select_own" on public.daily_log_attachments
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "daily_log_attachments_insert_own" on public.daily_log_attachments
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "daily_log_attachments_delete_own" on public.daily_log_attachments
  for delete to authenticated using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- Private bucket, one folder per user, 10 MB per file.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'checkin-attachments', 'checkin-attachments', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create policy "checkin_attachments_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'checkin-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "checkin_attachments_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'checkin-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "checkin_attachments_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'checkin-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- -----------------------------------------------------------------------------
-- apply_daily_checkin: new tasks may now declare their own source, so tasks
-- derived from an attachment are distinguishable from rescheduled work.
-- -----------------------------------------------------------------------------
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

  -- 4. New work: rescheduled follow-ups and anything derived from attachments.
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
