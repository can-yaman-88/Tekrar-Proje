-- =============================================================================
-- When a piece of work may start.
--
-- A homework due Monday is not Monday's task; it is the weekend's work with a
-- Monday deadline. The app spreads such work over the days before its deadline
-- automatically (see _shared/domain/workload.ts), but the student sometimes
-- knows better — "bunu bugünden başlatayım" — and that decision belongs to
-- them, not to a heuristic.
--
-- null means "derive it": the window opens a week before the deadline.
-- =============================================================================
alter table public.tasks
  add column starts_on date,
  add constraint tasks_starts_on_before_due check (starts_on is null or starts_on <= due_date);

comment on column public.tasks.starts_on is
  'Earliest day this work should appear in the daily plan. null = derived from the deadline.';
