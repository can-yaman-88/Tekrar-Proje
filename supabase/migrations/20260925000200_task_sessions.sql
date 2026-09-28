-- =============================================================================
-- Study sessions: how long the work really took.
--
-- The planner has been budgeting with estimates ("a Feynman page is 25 minutes")
-- because that was all it had. A session row is the measured truth, and it is
-- what the capacity learner prefers from now on.
-- =============================================================================
create table public.task_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  task_id     uuid not null,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  /** Filled when the session ends; also lets a session be logged by hand. */
  minutes     smallint check (minutes >= 0 and minutes <= 1440),
  created_at  timestamptz not null default now(),

  constraint task_sessions_id_user_key unique (id, user_id),
  constraint task_sessions_task_fk
    foreign key (task_id, user_id) references public.tasks (id, user_id) on delete cascade,
  constraint task_sessions_time_order check (ended_at is null or ended_at >= started_at),
  constraint task_sessions_minutes_when_closed check ((ended_at is null) = (minutes is null))
);

create index task_sessions_task_idx on public.task_sessions (task_id, started_at desc);
create index task_sessions_user_started_idx on public.task_sessions (user_id, started_at desc);
-- One running session at a time: a timer left on elsewhere should be obvious.
create unique index task_sessions_single_running_idx on public.task_sessions (user_id)
  where ended_at is null;

alter table public.task_sessions enable row level security;

create policy "task_sessions_select_own" on public.task_sessions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "task_sessions_insert_own" on public.task_sessions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "task_sessions_update_own" on public.task_sessions
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "task_sessions_delete_own" on public.task_sessions
  for delete to authenticated using ((select auth.uid()) = user_id);
