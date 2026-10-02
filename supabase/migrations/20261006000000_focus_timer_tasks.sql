-- =============================================================================
-- Focus Timer, part two: a focus stretch can belong to a task.
--
-- The timer now lists the week's open tasks (and every open task under a
-- topic), so the student can say "this 50 minutes was the Feynman page". Such
-- a stretch is measured work on that task, exactly like Tekrar's own stopwatch:
-- it shows on the task's card and feeds the capacity learner and the
-- estimate-versus-actual numbers. Without a task it stays what it was — time
-- on a course or topic, kept out of the planner's budgets.
--
-- The stretch keeps its row in focus_sessions (the timer's own id makes resends
-- idempotent there); readers that care about measured work read both tables.
-- Only real work is offered: a group task is a container and its steps carry
-- the minutes, so the timer lists steps, never the container.
-- =============================================================================

alter table public.focus_sessions
  add column task_id uuid,
  -- A deleted task leaves its time with the topic.
  add constraint focus_sessions_task_fk
    foreign key (task_id, user_id) references public.tasks (id, user_id) on delete set null (task_id);

create index focus_sessions_task_idx on public.focus_sessions (task_id) where task_id is not null;

-- The task decides where the time is filed: its topic, and that topic's course.
create or replace function public.focus_sessions_check_topic()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.task_id is not null and not exists (
    select 1 from public.tasks t where t.id = new.task_id and t.topic_id is not distinct from new.topic_id
  ) then
    raise exception 'task % does not belong to topic %', new.task_id, new.topic_id
      using errcode = '23514';
  end if;
  if new.topic_id is not null and not exists (
    select 1 from public.topics t where t.id = new.topic_id and t.course_id = new.course_id
  ) then
    raise exception 'topic % does not belong to course %', new.topic_id, new.course_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger focus_sessions_check_topic on public.focus_sessions;
create trigger focus_sessions_check_topic
  before insert or update of task_id, topic_id, course_id on public.focus_sessions
  for each row execute function public.focus_sessions_check_topic();
