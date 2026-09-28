-- =============================================================================
-- Task notes + history support.
--
-- Notes are their own table rather than a column on tasks: a student adds
-- several over time ("forgot the sign convention", "Prof solved #14 in class"),
-- each with its own timestamp.
-- =============================================================================
create table public.task_notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  task_id     uuid not null,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint task_notes_id_user_key unique (id, user_id),
  constraint task_notes_task_fk
    foreign key (task_id, user_id) references public.tasks (id, user_id)
    on delete cascade
);

create index task_notes_task_created_idx on public.task_notes (task_id, created_at desc);
create index task_notes_user_idx on public.task_notes (user_id);

create trigger task_notes_set_updated_at
  before update on public.task_notes
  for each row execute function public.set_updated_at();

alter table public.task_notes enable row level security;

create policy "task_notes_select_own" on public.task_notes
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "task_notes_insert_own" on public.task_notes
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "task_notes_update_own" on public.task_notes
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "task_notes_delete_own" on public.task_notes
  for delete to authenticated using ((select auth.uid()) = user_id);

-- History screen: "my finished work, newest first".
create index tasks_user_completed_idx on public.tasks (user_id, completed_at desc)
  where status in ('completed', 'failed', 'skipped');
