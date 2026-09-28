-- =============================================================================
-- Deleting a past check-in.
--
-- Undo puts the plan back; it does not remove the record. A report written by
-- mistake — the wrong day, a test, something private — stays in the history
-- forever, and there was no way to get rid of it.
--
-- Deleting is two decisions, not one, so the caller states which it wants:
--   p_revert = true   undo what the check-in did, then delete the record;
--   p_revert = false  keep the plan as it is and delete the record only.
-- The second is one-way: the snapshots the undo needs go with the record, so
-- the caller has to have said so out loud.
--
-- The attachment rows cascade, but their files in storage do not: the paths are
-- returned so the caller can delete them. Tasks the check-in created keep
-- existing (`origin_daily_log_id` is ON DELETE SET NULL) — deleting a record is
-- never allowed to delete the student's work by a side effect.
-- =============================================================================
create or replace function public.delete_daily_checkin(
  p_daily_log_id uuid,
  p_revert       boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := auth.uid();
  v_log      record;
  v_reverted boolean := false;
  v_paths    text[];
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select id, status, reverted_at into v_log
    from public.daily_logs
   where id = p_daily_log_id and user_id = v_user
     for update;

  if not found then
    raise exception 'daily_log % not found', p_daily_log_id using errcode = 'P0002';
  end if;

  -- The undo runs first and inside this transaction: if it fails, nothing is
  -- deleted and the student still has both the record and their plan.
  if p_revert and v_log.status = 'succeeded' and v_log.reverted_at is null then
    perform public.revert_daily_checkin(p_daily_log_id);
    v_reverted := true;
  end if;

  select coalesce(array_agg(storage_path), '{}') into v_paths
    from public.daily_log_attachments
   where daily_log_id = p_daily_log_id and user_id = v_user;

  delete from public.daily_logs where id = p_daily_log_id and user_id = v_user;

  return jsonb_build_object('reverted', v_reverted, 'storage_paths', to_jsonb(v_paths));
end;
$$;

comment on function public.delete_daily_checkin(uuid, boolean) is
  'Removes a check-in record. With p_revert, undoes its effects first; without, the plan keeps them and the undo is gone for good.';

revoke execute on function public.delete_daily_checkin(uuid, boolean) from public, anon;
grant execute on function public.delete_daily_checkin(uuid, boolean) to authenticated;
