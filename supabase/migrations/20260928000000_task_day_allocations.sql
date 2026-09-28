-- =============================================================================
-- The student's own answer to "hangi gün ne kadar".
--
-- The app splits homework across the days before its deadline, weighted by how
-- much room each day has left. That is a good default and a bad law: only the
-- student knows that Saturday is a write-off and Sunday is wide open. So any
-- day can be pinned to a number of minutes, or switched off entirely, and the
-- rest of the work redistributes around those decisions.
--
-- Shape: {"2026-09-27": 60, "2026-09-28": 0} — minutes per day, 0 = kapalı.
-- =============================================================================
alter table public.tasks
  add column day_allocations jsonb,
  add constraint tasks_day_allocations_is_object
    check (day_allocations is null or jsonb_typeof(day_allocations) = 'object');

comment on column public.tasks.day_allocations is
  'Per-day minutes the student fixed by hand; days not listed are shared out automatically.';
