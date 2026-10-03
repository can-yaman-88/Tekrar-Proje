-- =============================================================================
-- Focus Timer on more than one device.
--
-- Until now a new pairing retired every older one, so the timer lived on one
-- phone at a time — and that phone also needed Tekrar, which handed the token
-- over with an Android intent.
--
--   * Each pairing knows its device. The timer sends its install id (and the
--     device's name) with every request; a device that pairs again retires
--     only its own older pairing, and the other devices keep working. An
--     account holds at most five pairings.
--
--   * A pairing code. Settings shows eight characters, valid for ten minutes
--     and once. Typed into the timer on any device, it becomes that device's
--     own token, so Tekrar does not have to be installed there. Only the code's
--     hash is kept. Guessing is capped twice — per caller, and across all
--     callers for failed tries — so 40 bits stay far out of reach even if the
--     per-caller address is forged.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Pairings learn their device.
-- ----------------------------------------------------------------------------
alter table public.focus_timer_links
  -- The timer install's own random id; null until a timer that sends one reports.
  add column device_id uuid,
  -- The device's name as the timer read it ("Galaxy A55"), for Settings.
  add column label text,
  add constraint focus_timer_links_label_length check (label is null or char_length(label) between 1 and 60);

create index focus_timer_links_active_idx on public.focus_timer_links (user_id, device_id) where revoked_at is null;

-- ----------------------------------------------------------------------------
-- 2. Pairing codes and the tries at them.
-- ----------------------------------------------------------------------------
create table public.focus_timer_pairing_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  code_hash   text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,

  constraint focus_timer_pairing_codes_hash_key unique (code_hash),
  constraint focus_timer_pairing_codes_hash_shape check (code_hash ~ '^[0-9a-f]{64}$')
);

create index focus_timer_pairing_codes_user_idx on public.focus_timer_pairing_codes (user_id);

-- A day of tries, never the address itself: only its hash.
create table public.focus_timer_claim_attempts (
  id           bigint generated always as identity primary key,
  source_hash  text not null,
  succeeded    boolean not null,
  created_at   timestamptz not null default now()
);

create index focus_timer_claim_attempts_source_idx on public.focus_timer_claim_attempts (source_hash, created_at desc);
create index focus_timer_claim_attempts_failed_idx on public.focus_timer_claim_attempts (created_at desc) where not succeeded;

-- Server-side only, like the pairings themselves.
alter table public.focus_timer_pairing_codes enable row level security;
alter table public.focus_timer_claim_attempts enable row level security;
revoke all on table public.focus_timer_pairing_codes from anon, authenticated;
revoke all on table public.focus_timer_claim_attempts from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Issuing: a token for the timer on this phone, or a code for any device.
-- ----------------------------------------------------------------------------

-- As before, plus the cap. An older pairing of the same phone still counts
-- here: which device the token lands on is only known at its first request.
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

  if (select count(*) from public.focus_timer_links where user_id = v_user and revoked_at is null) >= 5 then
    raise exception 'En fazla 5 cihaz bağlanabilir. Önce listeden birini kaldır.' using errcode = '23514';
  end if;

  -- 244 random bits from two v4 UUIDs; only the hash is stored.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.focus_timer_links (user_id, token_hash)
  values (v_user, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'token', v_token);
end;
$$;

-- Eight characters of Crockford base32 (no I, L, O or U to misread), ten
-- minutes, once. A new code replaces the student's earlier one. The cap is
-- checked when the code is used, where the device is known, so a full account
-- can still re-pair one of its own devices.
create or replace function public.issue_focus_timer_code()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := auth.uid();
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_expires  timestamptz := now() + interval '10 minutes';
  v_bytes    bytea;
  v_bits     bigint;
  v_code     text;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  delete from public.focus_timer_pairing_codes where user_id = v_user or expires_at < now();

  for attempt in 1..3 loop
    -- 40 bits from the first five bytes of a v4 UUID, which are all random.
    v_bytes := uuid_send(gen_random_uuid());
    v_bits := 0;
    for i in 0..4 loop
      v_bits := (v_bits << 8) | get_byte(v_bytes, i);
    end loop;
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(v_alphabet, (v_bits & 31)::int + 1, 1);
      v_bits := v_bits >> 5;
    end loop;

    begin
      insert into public.focus_timer_pairing_codes (user_id, code_hash, expires_at)
      values (v_user, encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), v_expires);
      return jsonb_build_object('code', v_code, 'expiresAt', v_expires);
    exception when unique_violation then
      -- Someone else holds the same eight characters right now: draw again.
      null;
    end;
  end loop;

  raise exception 'Kod oluşturulamadı. Bir daha dene.' using errcode = '55000';
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Using a code: called by the focus-timer function only (service role).
--
-- p_code arrives normalized (upper case, no dashes); p_source is the hash of
-- the caller's address. Answers {status: linked, token, account} or a status
-- of invalid, rate_limited or full. A code is spent only when it links.
-- ----------------------------------------------------------------------------
create or replace function public.claim_focus_timer_code(
  p_code      text,
  p_source    text,
  p_device_id uuid,
  p_label     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code  public.focus_timer_pairing_codes%rowtype;
  v_token text;
  v_email text;
begin
  -- One claim at a time keeps the counts below honest. Claims are rare.
  perform pg_advisory_xact_lock(hashtextextended('focus_timer_claim', 0));

  delete from public.focus_timer_claim_attempts where created_at < now() - interval '1 day';

  if (select count(*) from public.focus_timer_claim_attempts
       where source_hash = p_source and created_at > now() - interval '15 minutes') >= 10
     or (select count(*) from public.focus_timer_claim_attempts
          where not succeeded and created_at > now() - interval '15 minutes') >= 100 then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  select * into v_code
    from public.focus_timer_pairing_codes
   where code_hash = encode(sha256(convert_to(p_code, 'UTF8')), 'hex')
     and used_at is null
     and expires_at > now();

  insert into public.focus_timer_claim_attempts (source_hash, succeeded) values (p_source, v_code.id is not null);
  if v_code.id is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- This device's own older pairing does not count: its first request retires it.
  if (select count(*) from public.focus_timer_links
       where user_id = v_code.user_id
         and revoked_at is null
         and device_id is distinct from p_device_id) >= 5 then
    return jsonb_build_object('status', 'full');
  end if;

  update public.focus_timer_pairing_codes set used_at = now() where id = v_code.id;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.focus_timer_links (user_id, token_hash, device_id, label)
  values (
    v_code.user_id,
    encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
    p_device_id,
    nullif(btrim(left(p_label, 60)), '')
  );

  select u.email into v_email from auth.users u where u.id = v_code.user_id;
  return jsonb_build_object('status', 'linked', 'token', v_token, 'account', v_email);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. What Settings lists: every connected device.
--    (focus_timer_link_status stays for app builds from before this.)
-- ----------------------------------------------------------------------------
create or replace function public.focus_timer_devices()
returns table (id uuid, label text, linked_at timestamptz, last_used_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.label, l.created_at, l.last_used_at
    from public.focus_timer_links l
   where l.user_id = (select auth.uid())
     and l.revoked_at is null
   order by l.last_used_at desc nulls last, l.created_at desc;
$$;

revoke execute on function public.issue_focus_timer_code() from public, anon;
revoke execute on function public.focus_timer_devices() from public, anon;
revoke execute on function public.claim_focus_timer_code(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.issue_focus_timer_code() to authenticated;
grant execute on function public.focus_timer_devices() to authenticated;
grant execute on function public.claim_focus_timer_code(text, text, uuid, text) to service_role;
