-- =============================================================================
-- Automatic weekly planning.
--
-- The plan should exist whether or not the student remembers to ask for it, so
-- a cron job calls generate-weekly-plan for every profile early on Monday.
--
-- The machinery ships here; the secrets do not. Call
-- `configure_weekly_plan_cron(url, service_key)` once per environment (service
-- role only) to store them in Vault and schedule the job.
-- =============================================================================
do $$
begin
  create extension if not exists pg_cron with schema extensions;
exception
  when others then raise notice 'pg_cron kurulamadı: %', sqlerrm;
end
$$;

do $$
begin
  create extension if not exists pg_net with schema extensions;
exception
  when others then raise notice 'pg_net kurulamadı: %', sqlerrm;
end
$$;

-- One request per student. The Edge Function accepts `userId` only from
-- service-role callers, and plans that user's week.
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

  for v_user in select id from public.profiles loop
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

-- Stores the secrets and (re)schedules the job. Safe to run again: the old
-- secrets and the old schedule are replaced.
create or replace function public.configure_weekly_plan_cron(p_function_url text, p_service_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule text := '0 5 * * 1';  -- Monday 05:00 UTC (08:00 in Türkiye)
begin
  if p_function_url is null or p_service_key is null then
    raise exception 'function url and service key are required';
  end if;

  delete from vault.secrets where name in ('weekly_plan_url', 'weekly_plan_key');
  perform vault.create_secret(p_function_url, 'weekly_plan_url', 'generate-weekly-plan endpoint');
  perform vault.create_secret(p_service_key, 'weekly_plan_key', 'service role key for the weekly plan cron');

  perform cron.unschedule('weekly-plan')
    where exists (select 1 from cron.job where jobname = 'weekly-plan');
  perform cron.schedule('weekly-plan', v_schedule, 'select public.kick_off_weekly_plans()');

  return format('weekly-plan scheduled at %s', v_schedule);
end;
$$;

revoke execute on function public.configure_weekly_plan_cron(text, text) from public, anon, authenticated;
grant execute on function public.configure_weekly_plan_cron(text, text) to service_role;
