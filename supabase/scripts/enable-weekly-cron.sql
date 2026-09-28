-- =============================================================================
-- Optional: run the weekly planner automatically, every Monday at 05:00 UTC.
--
-- Not part of the migrations, because it stores a secret and is an operational
-- choice. Run it by hand once per environment, after replacing the two
-- placeholders below.
--
--   <PROJECT_URL>      e.g. https://abcdefgh.supabase.co
--                      (local stack: http://host.docker.internal:54321)
--   <SERVICE_ROLE_KEY> from `supabase status` or the dashboard's API settings
--
-- The key is kept in Vault, never inline in the cron command.
-- =============================================================================
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- 1. Store the function URL and service key once.
select vault.create_secret('<PROJECT_URL>/functions/v1/generate-weekly-plan', 'weekly_plan_url');
select vault.create_secret('<SERVICE_ROLE_KEY>', 'weekly_plan_key');

-- 2. One request per user. The Edge Function accepts `userId` only from
--    service-role callers, and plans that user's week.
create or replace function public.kick_off_weekly_plans()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
  v_user record;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'weekly_plan_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'weekly_plan_key';
  if v_url is null or v_key is null then
    raise exception 'weekly_plan_url / weekly_plan_key secrets are missing';
  end if;

  for v_user in select id from public.profiles loop
    perform extensions.net_http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body    := jsonb_build_object('userId', v_user.id),
      timeout_milliseconds := 60000
    );
  end loop;
end;
$$;

revoke execute on function public.kick_off_weekly_plans() from public, anon, authenticated;

-- 3. Monday 05:00 UTC (08:00 in Türkiye).
select cron.schedule('weekly-plan', '0 5 * * 1', $$select public.kick_off_weekly_plans()$$);

-- Useful afterwards:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 10;
--   select cron.unschedule('weekly-plan');
