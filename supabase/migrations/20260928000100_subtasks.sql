-- =============================================================================
-- Group tasks: one piece of work, a few steps.
--
-- A homework is often three things wearing one name: solve 1-8, draw the
-- graph, write it up. Listing them as three unrelated tasks loses the fact
-- that they are one obligation; listing them as one loses the ability to tick
-- them off as they go. So a task may carry subtasks — exactly one level deep.
--
-- Who may have them is a product rule, not a constraint here: only homework
-- and tasks the student explicitly asks to break up ever get children. The
-- database's job is to keep the structure honest.
-- =============================================================================
alter table public.tasks
  add column parent_task_id uuid,
  add constraint tasks_parent_not_self check (parent_task_id is null or parent_task_id <> id),
  add constraint tasks_parent_fk
    foreign key (parent_task_id, user_id) references public.tasks (id, user_id) on delete cascade;

create index tasks_parent_idx on public.tasks (parent_task_id) where parent_task_id is not null;

-- ----------------------------------------------------------------------------
-- One level, no more. A subtask cannot become a parent, and a parent cannot be
-- adopted by someone else.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_single_task_level()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parent_task_id is not null then
    if exists (select 1 from public.tasks p where p.id = new.parent_task_id and p.parent_task_id is not null) then
      raise exception 'a subtask cannot have subtasks of its own' using errcode = '23514';
    end if;
    if exists (select 1 from public.tasks c where c.parent_task_id = new.id) then
      raise exception 'a task with subtasks cannot become a subtask' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger tasks_single_level
  before insert or update of parent_task_id on public.tasks
  for each row execute function public.enforce_single_task_level();

-- ----------------------------------------------------------------------------
-- The parent's status is not its own: it is whatever its steps add up to.
-- ----------------------------------------------------------------------------
create or replace function public.sync_parent_task_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent uuid := coalesce(new.parent_task_id, old.parent_task_id);
  v_total  integer;
  v_done   integer;
  v_open   integer;
  v_status public.task_status;
  v_solved integer;
begin
  if v_parent is null then
    return coalesce(new, old);
  end if;

  select count(*),
         count(*) filter (where status = 'completed'),
         count(*) filter (where status in ('pending', 'in_progress', 'failed', 'rescheduled')),
         coalesce(sum(completed_count), 0)
    into v_total, v_done, v_open, v_solved
    from public.tasks
   where parent_task_id = v_parent;

  if v_total = 0 then
    return coalesce(new, old);   -- last subtask removed: the parent keeps its own state
  elsif v_done = v_total then
    v_status := 'completed';
  elsif v_open = 0 then
    v_status := 'skipped';       -- everything left was skipped
  elsif v_done > 0 or v_solved > 0 then
    v_status := 'in_progress';
  else
    v_status := 'pending';
  end if;

  update public.tasks
     set status       = v_status,
         completed_at = case when v_status = 'completed' then coalesce(completed_at, now()) end
   where id = v_parent and status is distinct from v_status;

  return coalesce(new, old);
end;
$$;

create trigger tasks_sync_parent
  after insert or update of status, completed_count, parent_task_id or delete on public.tasks
  for each row execute function public.sync_parent_task_status();
