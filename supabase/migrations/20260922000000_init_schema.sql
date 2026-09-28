-- =============================================================================
-- Tekrar — initial schema
-- Postgres 15+ (Supabase). Requires: auth schema, storage schema.
--
-- Ownership model
--   Every user-owned table carries user_id, and every parent → child link is a
--   COMPOSITE foreign key (parent_id, user_id) → parent(id, user_id).
--   This makes the redundant user_id impossible to drift (no update anomaly),
--   makes cross-tenant links impossible at the constraint level, and lets every
--   RLS policy be the index-friendly predicate `user_id = (select auth.uid())`
--   instead of a multi-hop EXISTS join.
--
-- Write model
--   Client (anon key + user JWT, RLS enforced) owns: courses, exams, topics,
--   exam_topics, tasks, and the *creation* of daily_logs / syllabus_uploads.
--   Edge Functions (service role, explicit user_id filters) own processing
--   state: status, error_message, llm_model, processed_at, summary, and all
--   rows in daily_log_task_updates.
--
-- Dates
--   due_date / log_date / exam_date / next_review_on are the user's LOCAL
--   calendar date (profiles.timezone), never derived from a UTC timestamp.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Enums (mirrored 1:1 by Zod enums in supabase/functions/_shared/contracts)
-- -----------------------------------------------------------------------------
create type public.task_type as enum (
  'problem_set',      -- "Solve 30 truss problems"
  'concept_review',   -- read / re-derive theory
  'derivation',       -- reproduce a derivation from memory (e.g. Carnot efficiency)
  'spaced_review',    -- SM-2 driven revisit of a topic
  'mock_exam'         -- timed mixed-topic set
);

create type public.task_status as enum (
  'pending',
  'in_progress',
  'completed',
  'failed',           -- attempted, could not solve → triggers reschedule
  'rescheduled',      -- superseded by a newer task (see tasks.rescheduled_from_task_id)
  'skipped'
);

create type public.task_source as enum (
  'manual',
  'ai_weekly_plan',
  'ai_checkin_reschedule',
  'spaced_repetition'
);

create type public.exam_kind as enum ('quiz', 'midterm', 'final', 'lab', 'other');

create type public.processing_status as enum ('pending', 'processing', 'succeeded', 'failed');


-- -----------------------------------------------------------------------------
-- Shared trigger functions
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- profiles  (the "Users" table; 1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text check (char_length(display_name) between 1 and 80),
  timezone      text not null default 'UTC',  -- IANA name, validated by Zod
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(left(new.raw_user_meta_data ->> 'display_name', 80), ''));
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- -----------------------------------------------------------------------------
-- courses
-- -----------------------------------------------------------------------------
create table public.courses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  code        text check (char_length(code) between 1 and 20),       -- "PHYS 102"
  name        text not null check (char_length(name) between 1 and 120),
  color_hex   text check (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint courses_id_user_key unique (id, user_id)
);

create unique index courses_user_name_key on public.courses (user_id, lower(name));

create trigger courses_set_updated_at
  before update on public.courses
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- syllabus_uploads  (ingestion pipeline state; one row per uploaded PDF)
-- -----------------------------------------------------------------------------
create table public.syllabus_uploads (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  course_id          uuid,                                   -- set once parsed
  storage_path       text not null unique,                   -- "<user_id>/<uuid>.pdf"
  original_filename  text not null check (char_length(original_filename) between 1 and 255),
  status             public.processing_status not null default 'pending',
  llm_model          text,
  error_message      text,
  processed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint syllabus_uploads_id_user_key unique (id, user_id),
  constraint syllabus_uploads_course_fk
    foreign key (course_id, user_id) references public.courses (id, user_id)
    on delete set null (course_id),
  constraint syllabus_uploads_path_owned
    check (storage_path like user_id::text || '/%'),
  constraint syllabus_uploads_error_iff_failed
    check ((status = 'failed') = (error_message is not null))
);

create index syllabus_uploads_user_created_idx on public.syllabus_uploads (user_id, created_at desc);
create index syllabus_uploads_course_idx on public.syllabus_uploads (course_id) where course_id is not null;

create trigger syllabus_uploads_set_updated_at
  before update on public.syllabus_uploads
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- exams  (a course has many exams → separate table, not columns on courses)
-- -----------------------------------------------------------------------------
create table public.exams (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  course_id       uuid not null,
  kind            public.exam_kind not null,
  title           text not null check (char_length(title) between 1 and 120),
  exam_date       date not null,
  start_time      time,                                     -- syllabi often omit it
  weight_percent  numeric(5, 2) check (weight_percent > 0 and weight_percent <= 100),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint exams_id_user_key unique (id, user_id),
  constraint exams_course_fk
    foreign key (course_id, user_id) references public.courses (id, user_id)
    on delete cascade
);

create index exams_user_date_idx on public.exams (user_id, exam_date);
create index exams_course_idx on public.exams (course_id);

create trigger exams_set_updated_at
  before update on public.exams
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- topics  (FK → courses; also holds per-topic SM-2 spaced-repetition state)
-- -----------------------------------------------------------------------------
create table public.topics (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  course_id         uuid not null,
  title             text not null check (char_length(title) between 1 and 200),
  week_number       smallint check (week_number between 1 and 30),
  position          smallint not null default 0 check (position >= 0),

  -- SM-2 state
  ease_factor       numeric(4, 2) not null default 2.50 check (ease_factor >= 1.30),
  interval_days     integer not null default 0 check (interval_days >= 0),
  repetitions       integer not null default 0 check (repetitions >= 0),
  next_review_on    date,
  last_reviewed_at  timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint topics_id_user_key unique (id, user_id),
  constraint topics_course_week_position_key unique (course_id, week_number, position),
  constraint topics_course_fk
    foreign key (course_id, user_id) references public.courses (id, user_id)
    on delete cascade
);

create index topics_user_review_idx on public.topics (user_id, next_review_on)
  where next_review_on is not null;

create trigger topics_set_updated_at
  before update on public.topics
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- exam_topics  (M:N — which topics an exam covers; drives exam-proximity weighting)
-- -----------------------------------------------------------------------------
create table public.exam_topics (
  exam_id   uuid not null,
  topic_id  uuid not null,
  user_id   uuid not null references public.profiles (id) on delete cascade,

  primary key (exam_id, topic_id),
  constraint exam_topics_exam_fk
    foreign key (exam_id, user_id) references public.exams (id, user_id) on delete cascade,
  constraint exam_topics_topic_fk
    foreign key (topic_id, user_id) references public.topics (id, user_id) on delete cascade
);

create index exam_topics_topic_idx on public.exam_topics (topic_id);
create index exam_topics_user_idx on public.exam_topics (user_id);


-- -----------------------------------------------------------------------------
-- daily_logs  (raw NLP check-in; processed asynchronously by an Edge Function)
-- Declared before tasks so tasks.origin_daily_log_id can reference it.
-- -----------------------------------------------------------------------------
create table public.daily_logs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  log_date       date not null,
  raw_text       text not null check (char_length(raw_text) between 3 and 4000),
  status         public.processing_status not null default 'pending',
  summary        text check (char_length(summary) <= 500),   -- LLM one-liner for history UI
  llm_model      text,
  error_message  text,
  processed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint daily_logs_id_user_key unique (id, user_id),
  constraint daily_logs_error_iff_failed
    check ((status = 'failed') = (error_message is not null))
);

create index daily_logs_user_date_idx on public.daily_logs (user_id, log_date desc);

create trigger daily_logs_set_updated_at
  before update on public.daily_logs
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- tasks  (FK → topics; the unit of work shown on the Mission screen)
-- -----------------------------------------------------------------------------
create table public.tasks (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references public.profiles (id) on delete cascade,
  topic_id                  uuid not null,
  type                      public.task_type not null,
  title                     text not null check (char_length(title) between 1 and 200),
  instructions              text check (char_length(instructions) <= 2000),
  target_count              smallint check (target_count > 0),          -- e.g. 30 problems
  completed_count           smallint not null default 0 check (completed_count >= 0),
  estimated_minutes         smallint check (estimated_minutes between 5 and 600),
  due_date                  date not null,
  status                    public.task_status not null default 'pending',
  confidence_level          smallint check (confidence_level between 1 and 5),
  source                    public.task_source not null default 'manual',
  rescheduled_from_task_id  uuid,     -- lineage: failed task → its replacement
  origin_daily_log_id       uuid,     -- check-in that caused this task to exist
  completed_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint tasks_id_user_key unique (id, user_id),
  constraint tasks_topic_fk
    foreign key (topic_id, user_id) references public.topics (id, user_id)
    on delete cascade,
  constraint tasks_rescheduled_from_fk
    foreign key (rescheduled_from_task_id, user_id) references public.tasks (id, user_id)
    on delete set null (rescheduled_from_task_id),
  constraint tasks_origin_log_fk
    foreign key (origin_daily_log_id, user_id) references public.daily_logs (id, user_id)
    on delete set null (origin_daily_log_id),
  constraint tasks_completed_at_iff_completed
    check ((status = 'completed') = (completed_at is not null)),
  constraint tasks_not_self_rescheduled
    check (rescheduled_from_task_id is distinct from id)
);

-- Mission screen hot path: "my open tasks due on/before X"
create index tasks_user_due_open_idx on public.tasks (user_id, due_date)
  where status in ('pending', 'in_progress');
create index tasks_topic_idx on public.tasks (topic_id);
create index tasks_rescheduled_from_idx on public.tasks (rescheduled_from_task_id)
  where rescheduled_from_task_id is not null;
create index tasks_origin_log_idx on public.tasks (origin_daily_log_id)
  where origin_daily_log_id is not null;

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- daily_log_task_updates  (audit trail: what a check-in changed on which task)
-- -----------------------------------------------------------------------------
create table public.daily_log_task_updates (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  daily_log_id      uuid not null,
  task_id           uuid not null,
  previous_status   public.task_status not null,
  new_status        public.task_status not null,
  confidence_level  smallint check (confidence_level between 1 and 5),
  problems_solved   smallint check (problems_solved >= 0),
  note              text check (char_length(note) <= 500),
  created_at        timestamptz not null default now(),

  constraint daily_log_task_updates_log_task_key unique (daily_log_id, task_id),
  constraint daily_log_task_updates_log_fk
    foreign key (daily_log_id, user_id) references public.daily_logs (id, user_id)
    on delete cascade,
  constraint daily_log_task_updates_task_fk
    foreign key (task_id, user_id) references public.tasks (id, user_id)
    on delete cascade
);

create index daily_log_task_updates_task_idx on public.daily_log_task_updates (task_id);
create index daily_log_task_updates_user_idx on public.daily_log_task_updates (user_id);


-- =============================================================================
-- Row Level Security
-- `(select auth.uid())` is wrapped so Postgres evaluates it once per statement
-- (initPlan) instead of once per row.
-- No policies for `anon` → anon sees nothing. service_role bypasses RLS.
-- =============================================================================
revoke all on all tables in schema public from anon;

alter table public.profiles               enable row level security;
alter table public.courses                enable row level security;
alter table public.syllabus_uploads       enable row level security;
alter table public.exams                  enable row level security;
alter table public.topics                 enable row level security;
alter table public.exam_topics            enable row level security;
alter table public.daily_logs             enable row level security;
alter table public.tasks                  enable row level security;
alter table public.daily_log_task_updates enable row level security;

-- profiles: read/update self. Insert via trigger; delete via auth.users cascade.
create policy "profiles_select_own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- courses: full CRUD on own rows
create policy "courses_select_own" on public.courses
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "courses_insert_own" on public.courses
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "courses_update_own" on public.courses
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "courses_delete_own" on public.courses
  for delete to authenticated using ((select auth.uid()) = user_id);

-- exams: full CRUD on own rows
create policy "exams_select_own" on public.exams
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "exams_insert_own" on public.exams
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "exams_update_own" on public.exams
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "exams_delete_own" on public.exams
  for delete to authenticated using ((select auth.uid()) = user_id);

-- topics: full CRUD on own rows
create policy "topics_select_own" on public.topics
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "topics_insert_own" on public.topics
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "topics_update_own" on public.topics
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "topics_delete_own" on public.topics
  for delete to authenticated using ((select auth.uid()) = user_id);

-- exam_topics: select/insert/delete (junction rows are never updated)
create policy "exam_topics_select_own" on public.exam_topics
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "exam_topics_insert_own" on public.exam_topics
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "exam_topics_delete_own" on public.exam_topics
  for delete to authenticated using ((select auth.uid()) = user_id);

-- tasks: full CRUD on own rows (manual edits, optimistic status toggles)
create policy "tasks_select_own" on public.tasks
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "tasks_insert_own" on public.tasks
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "tasks_update_own" on public.tasks
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "tasks_delete_own" on public.tasks
  for delete to authenticated using ((select auth.uid()) = user_id);

-- syllabus_uploads: client creates a pending row and reads it; processing
-- columns are written only by the ingest-syllabus Edge Function.
create policy "syllabus_uploads_select_own" on public.syllabus_uploads
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "syllabus_uploads_insert_own_pending" on public.syllabus_uploads
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and status = 'pending'
    and course_id is null
    and llm_model is null
    and processed_at is null
  );
create policy "syllabus_uploads_delete_own" on public.syllabus_uploads
  for delete to authenticated using ((select auth.uid()) = user_id);

-- daily_logs: same pattern — client submits raw_text, function processes it.
create policy "daily_logs_select_own" on public.daily_logs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "daily_logs_insert_own_pending" on public.daily_logs
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and status = 'pending'
    and summary is null
    and llm_model is null
    and processed_at is null
  );
create policy "daily_logs_delete_own" on public.daily_logs
  for delete to authenticated using ((select auth.uid()) = user_id);

-- daily_log_task_updates: read-only audit for the client
create policy "daily_log_task_updates_select_own" on public.daily_log_task_updates
  for select to authenticated using ((select auth.uid()) = user_id);


-- =============================================================================
-- Storage: private bucket, objects namespaced by "<user_id>/..."
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('syllabi', 'syllabi', false, 20971520, array['application/pdf'])  -- 20 MB
on conflict (id) do nothing;

create policy "syllabi_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'syllabi' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "syllabi_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'syllabi' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "syllabi_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'syllabi' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- No update policy: uploads are immutable; re-upload = new object + new row.


-- =============================================================================
-- Realtime: the app subscribes to processing-status changes (RLS still applies)
-- =============================================================================
alter publication supabase_realtime add table public.daily_logs, public.syllabus_uploads;
