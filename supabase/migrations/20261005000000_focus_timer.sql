-- =============================================================================
-- Focus Timer: study time measured on the phone's own timer app.
--
-- The student runs their focus sessions in a separate Android app and picks a
-- course — and, if they like, a topic — before starting. Each finished focus
-- stretch lands here, so Tekrar can say how long went into which topic.
--
--   * focus_timer_links — a pairing between one account and the timer app.
--     Tekrar issues a random token and hands it straight to the timer (an
--     explicit Android intent); only its SHA-256 is kept. The token can do two
--     things, through the focus-timer Edge Function and nothing else: read the
--     course and topic names, and write focus sessions. Revoking it from
--     Settings cuts the timer off at the next request.
--
--   * focus_sessions — one row per focus stretch. Kept apart from
--     task_sessions on purpose: those belong to a task and feed the capacity
--     learner's estimate-versus-actual numbers, while timer time is only known
--     per course or topic. Mixing them would skew the planner's budgets.
--     client_id is the timer's own id for the stretch, so a retried upload
--     updates the row instead of counting it twice.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Pairings.
-- ----------------------------------------------------------------------------
create table public.focus_timer_links (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  token_hash    text not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz,

  constraint focus_timer_links_token_hash_key unique (token_hash),
  constraint focus_timer_links_token_hash_shape check (token_hash ~ '^[0-9a-f]{64}$')
);

create index focus_timer_links_user_idx on public.focus_timer_links (user_id, created_at desc);

-- No policies and no grants: the app reaches it only through the functions
-- below, so the token hash never travels to a phone.
alter table public.focus_timer_links enable row level security;
revoke all on table public.focus_timer_links from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Focus sessions.
-- ----------------------------------------------------------------------------
create table public.focus_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  client_id   uuid not null,
  course_id   uuid not null,
  topic_id    uuid,
  kind        text not null,
  started_at  timestamptz not null,
  ended_at    timestamptz not null,
  minutes     smallint not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint focus_sessions_client_key unique (user_id, client_id),
  constraint focus_sessions_course_fk
    foreign key (course_id, user_id) references public.courses (id, user_id) on delete cascade,
  -- A deleted topic leaves its time with the course.
  constraint focus_sessions_topic_fk
    foreign key (topic_id, user_id) references public.topics (id, user_id) on delete set null (topic_id),
  constraint focus_sessions_kind check (kind in ('timer', 'stopwatch', 'manual')),
  constraint focus_sessions_time_order check (ended_at >= started_at),
  constraint focus_sessions_minutes check (minutes between 1 and 1440)
);

create index focus_sessions_user_started_idx on public.focus_sessions (user_id, started_at desc);
create index focus_sessions_course_idx on public.focus_sessions (course_id, started_at desc);
create index focus_sessions_topic_idx on public.focus_sessions (topic_id) where topic_id is not null;

create trigger focus_sessions_set_updated_at
  before update on public.focus_sessions
  for each row execute function public.set_updated_at();

-- The topic must be one of the course's own: time filed under "Physics" must
-- not be counted for a calculus topic.
create or replace function public.focus_sessions_check_topic()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.topic_id is not null and not exists (
    select 1 from public.topics t where t.id = new.topic_id and t.course_id = new.course_id
  ) then
    raise exception 'topic % does not belong to course %', new.topic_id, new.course_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger focus_sessions_check_topic
  before insert or update of topic_id, course_id on public.focus_sessions
  for each row execute function public.focus_sessions_check_topic();

alter table public.focus_sessions enable row level security;
revoke all on table public.focus_sessions from anon;

-- Written only by the Edge Function (service role); the app reads and may
-- remove a mistaken stretch.
create policy "focus_sessions_select_own" on public.focus_sessions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "focus_sessions_delete_own" on public.focus_sessions
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- 3. Pairing functions, called by the app.
-- ----------------------------------------------------------------------------

-- A new token for the timer. Earlier pairings keep working until the new one
-- is first used (the Edge Function retires them then), so a pairing the
-- student cancels halfway never cuts off a timer that was already connected.
create or replace function public.issue_focus_timer_link()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := auth.uid();
  v_token text;
  v_id    uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- 244 random bits from two v4 UUIDs; only the hash is stored.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.focus_timer_links (user_id, token_hash)
  values (v_user, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'token', v_token);
end;
$$;

-- With an id: withdraws that one pairing (a cancelled hand-over).
-- Without: disconnects the timer altogether.
create or replace function public.revoke_focus_timer_link(p_link_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  update public.focus_timer_links
     set revoked_at = now()
   where user_id = v_user
     and revoked_at is null
     and (p_link_id is null or id = p_link_id);
end;
$$;

-- What Settings shows: is a timer connected, and when did it last report.
create or replace function public.focus_timer_link_status()
returns table (linked_at timestamptz, last_used_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select l.created_at, l.last_used_at
    from public.focus_timer_links l
   where l.user_id = (select auth.uid())
     and l.revoked_at is null
   order by l.last_used_at desc nulls last, l.created_at desc
   limit 1;
$$;

revoke execute on function public.issue_focus_timer_link() from public, anon;
revoke execute on function public.revoke_focus_timer_link(uuid) from public, anon;
revoke execute on function public.focus_timer_link_status() from public, anon;
grant execute on function public.issue_focus_timer_link() to authenticated;
grant execute on function public.revoke_focus_timer_link(uuid) to authenticated;
grant execute on function public.focus_timer_link_status() to authenticated;
