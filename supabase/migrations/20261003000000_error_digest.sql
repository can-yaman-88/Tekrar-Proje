-- =============================================================================
-- A weekly look at what went wrong.
--
-- app_error_reports fills up quietly: nobody opens the dashboard to read it.
-- This turns the pile into something that arrives on its own, once a week:
--
--   1. Reports are grouped. The same failure on a different task or at a
--      different count is the same failure; a fingerprint built from where it
--      happened and its message with ids and numbers taken out says so.
--   2. Every Monday a digest of the week is stored and pushed to the app's
--      admins (an email follows when one is configured).
--   3. Admins read the digest and each group's reports in the app, and mark a
--      group as fixed — a fixed group that shows up again is flagged as back.
--
-- Who is an admin is decided in the dashboard (insert into app_admins), never
-- from a device; everything here is read through functions that check it.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Grouping.
-- ----------------------------------------------------------------------------
alter table public.app_error_reports
  add column fingerprint text generated always as (
    md5(
      source || '|' || kind || '|' ||
      coalesce(detail ->> 'where', detail ->> 'operation', '') || '|' ||
      regexp_replace(
        regexp_replace(
          message,
          '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<id>', 'gi'
        ),
        '[0-9]+', '#', 'g'
      )
    )
  ) stored;

comment on column public.app_error_reports.fingerprint is
  'One failure, whatever ids and numbers it carried: source, kind, place and the message with those taken out.';

create index app_error_reports_fingerprint_idx on public.app_error_reports (fingerprint, created_at desc);

-- ----------------------------------------------------------------------------
-- 2. Admins. Added in the dashboard; a device can only ask whether it is one.
-- ----------------------------------------------------------------------------
create table public.app_admins (
  user_id  uuid primary key references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

create policy "app_admins_select_own" on public.app_admins
  for select to authenticated using ((select auth.uid()) = user_id);
-- No insert, update or delete policy: nobody promotes themselves.

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_admins a where a.user_id = (select auth.uid()));
$$;

revoke execute on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;

-- ----------------------------------------------------------------------------
-- 3. What an admin decided about a group: fixed (and when), with a note.
-- ----------------------------------------------------------------------------
create table public.error_group_states (
  fingerprint text primary key check (fingerprint ~ '^[0-9a-f]{32}$'),
  resolved_at timestamptz,
  note        text check (note is null or char_length(note) <= 500),
  updated_at  timestamptz not null default now()
);

alter table public.error_group_states enable row level security;
-- No policies: read and written only through the admin functions below.

-- ----------------------------------------------------------------------------
-- 4. One digest per week, kept for a year.
-- ----------------------------------------------------------------------------
create table public.error_digests (
  week_start  date primary key,
  period_from timestamptz not null,
  period_to   timestamptz not null,
  payload     jsonb not null,
  created_at  timestamptz not null default now(),
  notified_at timestamptz,
  constraint error_digests_period check (period_from < period_to)
);

alter table public.error_digests enable row level security;

create policy "error_digests_select_admin" on public.error_digests
  for select to authenticated using ((select public.is_app_admin()));

-- ----------------------------------------------------------------------------
-- 5. The digest itself: one window, compared with the window before it.
-- ----------------------------------------------------------------------------
create or replace function public.error_digest_payload(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with win as (
    select r.*
      from public.app_error_reports r
     where r.created_at >= p_from and r.created_at < p_to
  ),
  grp as (
    select w.fingerprint,
           count(*)::int                    as n,
           count(distinct w.user_id)::int   as users,
           max(w.created_at)                as last_seen,
           -- The newest report speaks for the group.
           (array_agg(w.source order by w.created_at desc))[1]  as source,
           (array_agg(w.kind order by w.created_at desc))[1]    as kind,
           (array_agg(coalesce(w.detail ->> 'where', w.detail ->> 'operation')
                      order by w.created_at desc))[1]          as location,
           (array_agg(w.message order by w.created_at desc))[1] as message,
           (array_agg(w.app_version order by w.created_at desc))[1] as app_version
      from win w
     group by w.fingerprint
  ),
  decorated as (
    select g.*,
           first_seen.at                                          as first_seen,
           s.resolved_at,
           first_seen.at >= p_from                                as is_new,
           s.resolved_at is not null and g.last_seen > s.resolved_at as is_regression
      from grp g
      cross join lateral (
        select min(r.created_at) as at from public.app_error_reports r where r.fingerprint = g.fingerprint
      ) first_seen
      left join public.error_group_states s on s.fingerprint = g.fingerprint
  ),
  ranked as (
    select d.* from decorated d
     order by d.is_regression desc, d.n desc, d.last_seen desc
     limit 10
  )
  select jsonb_build_object(
    'from',          p_from,
    'to',            p_to,
    'total',         (select count(*) from win),
    'previousTotal', (select count(*) from public.app_error_reports r
                       where r.created_at >= p_from - (p_to - p_from) and r.created_at < p_from),
    'groups',        (select count(*) from grp),
    'affectedUsers', (select count(distinct w.user_id) from win w),
    'newGroups',     (select count(*) from decorated where is_new),
    'regressions',   (select count(*) from decorated where is_regression),
    'bySource',      jsonb_build_object(
                       'app',  (select count(*) from win where source = 'app'),
                       'edge', (select count(*) from win where source = 'edge')),
    'versions',      coalesce((
                       select jsonb_agg(jsonb_build_object('version', v.app_version, 'platform', v.platform, 'count', v.n)
                                        order by v.n desc)
                         from (select w.app_version, w.platform, count(*)::int as n
                                 from win w where w.source = 'app'
                                group by 1, 2 order by 3 desc limit 6) v), '[]'::jsonb),
    'top',           coalesce((
                       select jsonb_agg(jsonb_build_object(
                                'fingerprint',  r.fingerprint,
                                'source',       r.source,
                                'kind',         r.kind,
                                'location',     r.location,
                                'message',      r.message,
                                'count',        r.n,
                                'users',        r.users,
                                'firstSeen',    r.first_seen,
                                'lastSeen',     r.last_seen,
                                'appVersion',   r.app_version,
                                'isNew',        r.is_new,
                                'isRegression', r.is_regression,
                                'resolvedAt',   r.resolved_at)
                              order by r.is_regression desc, r.n desc, r.last_seen desc)
                         from ranked r), '[]'::jsonb)
  );
$$;

revoke execute on function public.error_digest_payload(timestamptz, timestamptz) from public, anon, authenticated;

-- How a group reads in one line: the function for a server failure, the screen
-- or query for one in the app.
create or replace function public.error_group_label(p_source text, p_kind text, p_location text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_source = 'edge' then p_kind
           else coalesce(nullif(replace(btrim(translate(coalesce(p_location, ''), '[]"', ''), ' ,'), ',', ' › '), ''), p_kind)
         end;
$$;

-- ----------------------------------------------------------------------------
-- 6. What an admin can ask from the app.
-- ----------------------------------------------------------------------------
create or replace function public.admin_error_digest(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'days must be between 1 and 90' using errcode = '22023';
  end if;
  return public.error_digest_payload(now() - make_interval(days => p_days), now());
end;
$$;

revoke execute on function public.admin_error_digest(integer) from public, anon;
grant execute on function public.admin_error_digest(integer) to authenticated;

-- The reports behind one group, newest first. Who sent them is reduced to a
-- short tag: enough to tell one student from several, nothing more.
create or replace function public.admin_error_group_reports(p_fingerprint text, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reports jsonb;
  v_state   record;
begin
  if not public.is_app_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',         r.id,
           'createdAt',  r.created_at,
           'message',    r.message,
           'detail',     r.detail,
           'appVersion', r.app_version,
           'platform',   r.platform,
           'reporter',   case when r.user_id is null then null else left(md5(r.user_id::text), 6) end)
         order by r.created_at desc), '[]'::jsonb)
    into v_reports
    from (select * from public.app_error_reports
           where fingerprint = p_fingerprint
           order by created_at desc
           limit least(50, greatest(1, coalesce(p_limit, 20)))) r;

  select resolved_at, note into v_state from public.error_group_states where fingerprint = p_fingerprint;

  return jsonb_build_object(
    'reports',    v_reports,
    'resolvedAt', v_state.resolved_at,
    'note',       v_state.note
  );
end;
$$;

revoke execute on function public.admin_error_group_reports(text, integer) from public, anon;
grant execute on function public.admin_error_group_reports(text, integer) to authenticated;

-- "Düzelttim" — and "hayır, düzelmemiş". A fixed group that shows up again
-- after this moment is reported as back.
create or replace function public.admin_set_error_group_resolved(
  p_fingerprint text,
  p_resolved    boolean,
  p_note        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := case when p_resolved then now() end;
begin
  if not public.is_app_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.app_error_reports where fingerprint = p_fingerprint) then
    raise exception 'no reports for this group' using errcode = 'P0002';
  end if;

  insert into public.error_group_states (fingerprint, resolved_at, note, updated_at)
  values (p_fingerprint, v_at, left(nullif(btrim(p_note), ''), 500), now())
  on conflict (fingerprint) do update
     set resolved_at = excluded.resolved_at,
         note        = coalesce(excluded.note, public.error_group_states.note),
         updated_at  = now();

  return jsonb_build_object('fingerprint', p_fingerprint, 'resolvedAt', v_at);
end;
$$;

revoke execute on function public.admin_set_error_group_resolved(text, boolean, text) from public, anon;
grant execute on function public.admin_set_error_group_resolved(text, boolean, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Monday morning: store last week's digest and tell the admins.
-- ----------------------------------------------------------------------------
create or replace function public.html_escape(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(replace(coalesce(p_text, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
$$;

create or replace function public.send_error_digest()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Monday to Monday, on the UTC calendar the job itself runs on.
  v_to       timestamptz := (date_trunc('week', now() at time zone 'UTC')) at time zone 'UTC';
  v_from     timestamptz := v_to - interval '7 days';
  v_week     date        := (v_from at time zone 'UTC')::date;
  v_payload  jsonb;
  v_total    integer;
  v_prev     integer;
  v_top      jsonb;
  v_title    text;
  v_body     text;
  v_msgs     jsonb;
  v_access   text;
  v_resend   text;
  v_email_to text;
  v_from_addr text;
  v_rows     text;
  v_sent     integer := 0;
begin
  delete from public.error_digests where week_start < (now() at time zone 'UTC')::date - 371;

  if exists (select 1 from public.error_digests where week_start = v_week and notified_at is not null) then
    return 0;  -- already told
  end if;

  v_payload := public.error_digest_payload(v_from, v_to);
  insert into public.error_digests (week_start, period_from, period_to, payload)
  values (v_week, v_from, v_to, v_payload)
  on conflict (week_start) do update set payload = excluded.payload;

  v_total := (v_payload ->> 'total')::int;
  v_prev  := (v_payload ->> 'previousTotal')::int;

  -- A quiet week is kept, not announced.
  if v_total = 0 then
    update public.error_digests set notified_at = now() where week_start = v_week;
    return 0;
  end if;

  v_top := v_payload -> 'top' -> 0;
  v_title := case
               when (v_payload ->> 'regressions')::int > 0
                 then 'Hata özeti: ' || (v_payload ->> 'regressions') || ' hata geri döndü'
               else 'Haftalık hata özeti'
             end;
  v_body := v_total || ' hata, ' || (v_payload ->> 'groups') || ' grup'
            || case
                 when v_prev = v_total then ' (geçen haftayla aynı)'
                 else ' (geçen hafta ' || v_prev || ')'
               end
            || '. En sık: '
            || public.error_group_label(v_top ->> 'source', v_top ->> 'kind', v_top ->> 'location')
            || ' (' || (v_top ->> 'count') || ').';

  begin
    select decrypted_secret into v_access from vault.decrypted_secrets where name = 'expo_access_token';
  exception when others then
    v_access := null;
  end;

  select jsonb_agg(jsonb_build_object(
           'to', pt.token, 'title', v_title, 'body', v_body, 'sound', 'default',
           'channelId', 'reminders', 'data', jsonb_build_object('route', '/error-digest')))
    into v_msgs
    from public.push_tokens pt
    join public.app_admins a on a.user_id = pt.user_id;

  if v_msgs is not null then
    perform net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      body    := v_msgs,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Accept', 'application/json')
                 || case when v_access is null then '{}'::jsonb
                         else jsonb_build_object('Authorization', 'Bearer ' || v_access) end,
      timeout_milliseconds := 10000
    );
    v_sent := jsonb_array_length(v_msgs);
  end if;

  -- An email as well, when the dashboard was given what it needs (Resend).
  begin
    select decrypted_secret into v_resend from vault.decrypted_secrets where name = 'resend_api_key';
    select decrypted_secret into v_email_to from vault.decrypted_secrets where name = 'error_digest_email';
    select decrypted_secret into v_from_addr from vault.decrypted_secrets where name = 'error_digest_from';
  exception when others then
    v_resend := null;
  end;

  if v_resend is not null and v_email_to is not null then
    select string_agg(
             '<tr><td>' || (g ->> 'count') || '</td><td>'
             || public.html_escape(public.error_group_label(g ->> 'source', g ->> 'kind', g ->> 'location'))
             || case when (g ->> 'isRegression')::boolean then ' <b>(geri döndü)</b>'
                     when (g ->> 'isNew')::boolean then ' <b>(yeni)</b>' else '' end
             || '</td><td>' || public.html_escape(left(g ->> 'message', 200)) || '</td></tr>', '')
      into v_rows
      from jsonb_array_elements(v_payload -> 'top') g;

    perform net.http_post(
      url     := 'https://api.resend.com/emails',
      body    := jsonb_build_object(
                   'from', coalesce(v_from_addr, 'Tekrar <onboarding@resend.dev>'),
                   'to', jsonb_build_array(v_email_to),
                   'subject', v_title || ' — ' || to_char(v_week, 'DD.MM.YYYY') || ' haftası',
                   'html', '<p>' || public.html_escape(v_body) || '</p>'
                           || '<table cellpadding="6" border="1" style="border-collapse:collapse">'
                           || '<tr><th>Adet</th><th>Nerede</th><th>Son mesaj</th></tr>'
                           || coalesce(v_rows, '') || '</table>'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_resend),
      timeout_milliseconds := 10000
    );
  end if;

  update public.error_digests set notified_at = now() where week_start = v_week;
  return v_sent;
end;
$$;

revoke execute on function public.send_error_digest() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('error-digest', '17 6 * * 1', 'select public.send_error_digest()');
  end if;
exception
  when others then raise notice 'error-digest zamanlanamadı: %', sqlerrm;
end
$$;
