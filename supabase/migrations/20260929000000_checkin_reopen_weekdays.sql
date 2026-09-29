-- =============================================================================
-- Opening a weekday again.
--
-- "Pazarları hiç çalışamam" closes Sundays on the profile for good, and until
-- now a report could only ever close days. The student whose weekend job ended
-- wrote "pazarları artık çalışabiliyorum" and nothing happened: the only way
-- back was to find the old check-in and undo it — along with everything else
-- that check-in had done.
--
-- The lift runs straight after apply_daily_checkin, on the same log, exactly
-- like apply_checkin_edits: a setting that fails to change is not a reason to
-- fail the day's record. It keeps the same undo contract as closing does —
-- the value before this check-in rides along on the log (only if the close in
-- the same check-in has not already stored it), and revert_daily_checkin puts
-- it back.
-- =============================================================================
create or replace function public.apply_checkin_reopen_weekdays(
  p_user_id      uuid,
  p_daily_log_id uuid,
  p_weekdays     jsonb default '[]'::jsonb
)
returns smallint[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_log    record;
  v_open   smallint[];
  v_before smallint[];
  v_after  smallint[];
begin
  select status, reverted_at into v_log
    from public.daily_logs
   where id = p_daily_log_id and user_id = p_user_id
     for update;

  if not found then
    raise exception 'daily_log % not found', p_daily_log_id using errcode = 'P0002';
  end if;
  if v_log.status <> 'succeeded' or v_log.reverted_at is not null then
    raise exception 'daily_log % is not an open, processed check-in', p_daily_log_id
      using errcode = '55000';
  end if;

  select coalesce(array_agg(distinct value::smallint), '{}') into v_open
    from jsonb_array_elements_text(coalesce(p_weekdays, '[]'::jsonb)) as value
   where value ~ '^[1-7]$';

  select p.blocked_weekdays into v_before
    from public.profiles p
   where p.id = p_user_id
     for update;

  select coalesce(array_agg(w order by w), '{}') into v_after
    from unnest(v_before) as w
   where w <> all (v_open);

  -- Nothing that was closed is being opened: no change, and nothing to undo.
  if coalesce(array_length(v_after, 1), 0) = coalesce(array_length(v_before, 1), 0) then
    return v_before;
  end if;

  update public.daily_logs
     set previous_blocked_weekdays = v_before
   where id = p_daily_log_id and previous_blocked_weekdays is null;
  update public.profiles set blocked_weekdays = v_after where id = p_user_id;

  return v_after;
end;
$$;

comment on function public.apply_checkin_reopen_weekdays(uuid, uuid, jsonb) is
  'Opens weekdays a report says the student can study on again; revert_daily_checkin restores the previous set.';

revoke execute on function public.apply_checkin_reopen_weekdays(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_checkin_reopen_weekdays(uuid, uuid, jsonb) to service_role;
