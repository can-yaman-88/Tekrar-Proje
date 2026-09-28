-- =============================================================================
-- Two facts the planner was missing.
--
-- 1. Lab hours: the student handles labs on their own. A lab slot is never a
--    "the topic was taught today" signal and never produces work — but it is
--    still real time in the day, so it keeps counting against that day's budget.
--
-- 2. Term start: syllabi often date exams by week ("Midterm: 8. hafta") instead
--    of a calendar date. With the first week's date known, the ingester can put
--    such an exam on the Sunday of that week instead of dropping it.
-- =============================================================================
alter table public.class_sessions
  add column is_lab boolean not null default false;

comment on column public.class_sessions.is_lab is
  'Lab hours are excluded from planning decisions; only their time counts as busy.';

alter table public.courses
  add column term_start_date date;

comment on column public.courses.term_start_date is
  'Calendar date of week 1, when the syllabus states it. Lets week numbers be turned into dates.';
