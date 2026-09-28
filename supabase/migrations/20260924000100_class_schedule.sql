-- =============================================================================
-- Weekly class schedule + study-cycle support.
--
-- The timetable is plain user data: it stays exactly as entered until the
-- student edits it. The planner reads it to know which days are already busy
-- and which day each course is taught (study starts after the lecture).
-- =============================================================================
create table public.class_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  course_id   uuid not null,
  -- ISO-8601 weekday: 1 = Monday … 7 = Sunday.
  weekday     smallint not null check (weekday between 1 and 7),
  start_time  time not null,
  end_time    time not null,
  location    text check (char_length(location) between 1 and 80),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint class_sessions_id_user_key unique (id, user_id),
  constraint class_sessions_course_fk
    foreign key (course_id, user_id) references public.courses (id, user_id)
    on delete cascade,
  constraint class_sessions_time_order check (end_time > start_time),
  -- The same course cannot be entered twice for the same slot.
  constraint class_sessions_slot_key unique (course_id, weekday, start_time)
);

create index class_sessions_user_weekday_idx on public.class_sessions (user_id, weekday, start_time);
create index class_sessions_course_idx on public.class_sessions (course_id);

create trigger class_sessions_set_updated_at
  before update on public.class_sessions
  for each row execute function public.set_updated_at();

alter table public.class_sessions enable row level security;

create policy "class_sessions_select_own" on public.class_sessions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "class_sessions_insert_own" on public.class_sessions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "class_sessions_update_own" on public.class_sessions
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "class_sessions_delete_own" on public.class_sessions
  for delete to authenticated using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- Advanced problem sets are never scheduled unless the student says they have
-- material for that topic.
-- -----------------------------------------------------------------------------
alter table public.topics
  add column has_advanced_material boolean not null default false;

comment on column public.topics.has_advanced_material is
  'Only true when the student states they have harder problems for this topic; '
  'the planner refuses to schedule advanced_problems otherwise.';
