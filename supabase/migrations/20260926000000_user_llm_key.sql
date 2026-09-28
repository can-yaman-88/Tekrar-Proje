-- =============================================================================
-- The student's own OpenRouter key.
--
-- Until now the key was a project-wide Edge Function secret, which means the
-- owner of the deployment pays for every call. A student running their own
-- copy needs to supply their own key — but a key typed into a phone must not
-- end up readable by the phone, or sitting in a table in plain text.
--
-- So the key goes into Vault (encrypted at rest, one secret per user) and the
-- profile keeps only what is safe to show back: the last four characters and
-- when it was set. Reading the key itself is service-role only, so it travels
-- exactly one way — from the app into the vault, and from the vault into an
-- Edge Function.
-- =============================================================================
alter table public.profiles
  add column llm_key_set_at timestamptz,
  add column llm_key_hint text check (char_length(llm_key_hint) <= 8);

comment on column public.profiles.llm_key_hint is
  'Last characters of the stored key, so the student can recognise it. Never the key.';

/** Name of this user's vault secret. Deterministic, so there is at most one. */
create or replace function public.llm_key_secret_name(p_user_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$ select 'llm_key_' || p_user_id::text $$;

-- ----------------------------------------------------------------------------
-- Store / replace the key. Called by the student; never returns the key.
-- ----------------------------------------------------------------------------
create or replace function public.set_llm_api_key(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_key  text := btrim(coalesce(p_key, ''));
  v_name text;
  v_hint text;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- Long enough to be a key, short enough not to be a paste accident.
  if char_length(v_key) < 20 or char_length(v_key) > 400 then
    raise exception 'api key looks invalid' using errcode = '22023';
  end if;
  if v_key ~ '\s' then
    raise exception 'api key must not contain whitespace' using errcode = '22023';
  end if;

  v_name := public.llm_key_secret_name(v_user);
  v_hint := right(v_key, 4);

  delete from vault.secrets where name = v_name;
  perform vault.create_secret(v_key, v_name, 'per-user LLM API key');

  update public.profiles
     set llm_key_set_at = now(),
         llm_key_hint   = v_hint
   where id = v_user;

  return jsonb_build_object('hint', v_hint, 'set_at', now());
end;
$$;

revoke execute on function public.set_llm_api_key(text) from public, anon;
grant execute on function public.set_llm_api_key(text) to authenticated;

-- ----------------------------------------------------------------------------
-- Remove it and fall back to the project key.
-- ----------------------------------------------------------------------------
create or replace function public.clear_llm_api_key()
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

  delete from vault.secrets where name = public.llm_key_secret_name(v_user);
  update public.profiles set llm_key_set_at = null, llm_key_hint = null where id = v_user;
end;
$$;

revoke execute on function public.clear_llm_api_key() from public, anon;
grant execute on function public.clear_llm_api_key() to authenticated;

-- ----------------------------------------------------------------------------
-- Read it. Server side only: this is the one function that returns the secret,
-- so it is unreachable from the app's role.
-- ----------------------------------------------------------------------------
create or replace function public.read_llm_api_key(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = public.llm_key_secret_name(p_user_id);
  return v_key;
end;
$$;

revoke execute on function public.read_llm_api_key(uuid) from public, anon, authenticated;
grant execute on function public.read_llm_api_key(uuid) to service_role;
