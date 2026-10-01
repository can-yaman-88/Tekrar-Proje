-- =============================================================================
-- Two lines of work, one database.
--
-- The learning-task work (20260928000800 … 20260929000200) and the hardening
-- round (20261002000000) were written side by side. Everything they define is
-- disjoint, except one meeting point:
--
--   ungroup_task ("Grubu dağıt") sets a container that already has work on it
--   aside as 'skipped'. It ran as the student (security invoker), and the
--   status door (guard_task_status) refuses a status change made directly by
--   the student — so ungrouping a started task failed outright.
--
-- The function already proves ownership on every row it reads or writes
-- (user_id = auth.uid()), which is what lets it run as its owner instead, like
-- set_task_status, skip_tasks and move_tasks do. Its body is unchanged.
-- =============================================================================
alter function public.ungroup_task(uuid) security definer;

revoke execute on function public.ungroup_task(uuid) from public, anon;
grant execute on function public.ungroup_task(uuid) to authenticated;
