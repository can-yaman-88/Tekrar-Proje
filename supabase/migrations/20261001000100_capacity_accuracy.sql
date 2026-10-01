-- =============================================================================
-- A daily capacity that matches the student's real week.
--
-- The learned budget was wrong in ways the student could see but not fix:
--
--   · a catch-up report ("pazartesi kafesleri bitirdim, salı hiç…") stamped
--     every task it closed with the moment it was processed, so a week of work
--     landed on one evening and the other days read as empty
--   · dates were cut from UTC timestamps, not the student's own calendar
--   · and when the student simply knows better ("cumartesi 3 saat ayırırım"),
--     there was nothing to tell the planner with — only "kapalı" or nothing.
--
-- So: a check-in can date the work it closes to the day it happened, the
-- profile's timezone is guarded so it can be trusted, and each weekday can
-- carry the student's own number, which every planner obeys.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. The student's own budget per weekday.
-- ----------------------------------------------------------------------------
create or replace function public.is_valid_capacity_overrides(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_value) = 'object'
     and not exists (
       select 1
         from jsonb_each(p_value) as e(key, value)
        where e.key not in ('1', '2', '3', '4', '5', '6', '7')
           or jsonb_typeof(e.value) <> 'number'
           or (e.value #>> '{}')::numeric <> round((e.value #>> '{}')::numeric)
           or (e.value #>> '{}')::numeric < 15
           or (e.value #>> '{}')::numeric > 600
     )
$$;

alter table public.profiles
  add column capacity_overrides jsonb not null default '{}'::jsonb,
  add constraint profiles_capacity_overrides_valid check (public.is_valid_capacity_overrides(capacity_overrides));

comment on column public.profiles.capacity_overrides is
  'ISO weekday ("1" = Monday) → minutes the student says they can study that day (15–600). Overrides the learned value; a blocked weekday still wins.';

-- ----------------------------------------------------------------------------
-- 2. A timezone the server can actually use.
--
--    Every "which day was this" question on the server hangs off it, so an
--    unknown name is refused rather than discovered later as a wrong date.
-- ----------------------------------------------------------------------------
create or replace function public.is_valid_timezone(p_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = p_name)
$$;

alter table public.profiles
  add constraint profiles_timezone_valid check (public.is_valid_timezone(timezone));

-- ----------------------------------------------------------------------------
-- 3. Work reported for an earlier day is dated to that day.
--
--    Runs straight after apply_daily_checkin. Only tasks this check-in itself
--    moved into "completed" are touched, and only back to a day the report
--    covers; the undo restores completed_at from its own audit row as before.
-- ----------------------------------------------------------------------------
create or replace function public.backdate_checkin_completions(
  p_user_id      uuid,
  p_daily_log_id uuid,
  p_completions  jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_log     record;
  v_tz      text;
  v_updated integer := 0;
begin
  select log_date into v_log
    from public.daily_logs
   where id = p_daily_log_id and user_id = p_user_id and status = 'succeeded' and reverted_at is null;
  if not found then
    return 0;
  end if;

  select timezone into v_tz from public.profiles where id = p_user_id;
  v_tz := coalesce(v_tz, 'UTC');

  with dated as (
    update public.tasks t
       -- Midday local time: unambiguous whatever the offset.
       set completed_at = (c.completed_on + time '12:00') at time zone v_tz
      from jsonb_to_recordset(coalesce(p_completions, '[]'::jsonb)) as c(task_id uuid, completed_on date),
           public.daily_log_task_updates a
     where t.id = c.task_id
       and t.user_id = p_user_id
       and t.status = 'completed'
       and a.daily_log_id = p_daily_log_id
       and a.user_id = p_user_id
       and a.task_id = t.id
       and a.new_status = 'completed'
       and a.previous_status <> 'completed'
       and c.completed_on < v_log.log_date
       and c.completed_on >= v_log.log_date - 14
    returning 1
  )
  select count(*) into v_updated from dated;

  return v_updated;
end;
$$;

revoke execute on function public.backdate_checkin_completions(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.backdate_checkin_completions(uuid, uuid, jsonb) to service_role;
