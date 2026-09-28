-- =============================================================================
-- Automatic weekly planning becomes the student's choice.
--
-- The cron job now skips profiles that turned it off, so switching it off in
-- the app really stops the Monday run — nothing else has to change.
-- =============================================================================
alter table public.profiles
  add column auto_weekly_plan boolean not null default true;

comment on column public.profiles.auto_weekly_plan is
  'When false, the Monday cron leaves this student alone; they generate plans by hand.';

create or replace function public.kick_off_weekly_plans()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url   text;
  v_key   text;
  v_user  record;
  v_count integer := 0;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'weekly_plan_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'weekly_plan_key';
  if v_url is null or v_key is null then
    raise exception 'weekly_plan_url / weekly_plan_key secrets are missing';
  end if;

  for v_user in select id from public.profiles where auto_weekly_plan loop
    perform extensions.net_http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body    := jsonb_build_object('userId', v_user.id),
      timeout_milliseconds := 60000
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.kick_off_weekly_plans() from public, anon, authenticated;
