-- =============================================================================
-- Attachments: the PDF, the photo of the board, the video link — on a task,
-- and through it on the topic.
--
-- Material is about what is being learned, not about one sitting of it. The
-- slides used for Monday's learning task are what the review three weeks later
-- needs, so an attachment always belongs to a topic and, optionally, to the
-- task it was added from:
--
--   * a task's screen lists its own attachments, its group's, the file it was
--     derived from (a homework sheet sent with a check-in) and the rest of the
--     topic's — one list, nearest first;
--   * deleting a task never deletes its material: the attachment stays with
--     the topic (task_id goes null). This also covers every automatic clean-up
--     (a replanned week, a replaced exam plan): untouched work may go, what
--     the student added stays.
--
-- Files live in a private bucket, one folder per user. A row may only point at
-- an object that has really been uploaded, and its size and type are taken
-- from storage, not from the phone. Storage files cannot be removed from SQL,
-- so a deleted row leaves its path in storage_trash; the app empties it
-- through the Storage API.
-- =============================================================================

create type public.attachment_kind as enum ('file', 'link');

create table public.attachments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  topic_id      uuid not null,
  task_id       uuid,
  kind          public.attachment_kind not null,
  title         text not null,
  url           text,
  storage_path  text,
  mime_type     text,
  size_bytes    integer,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint attachments_id_user_key unique (id, user_id),
  constraint attachments_storage_path_key unique (storage_path),
  constraint attachments_topic_fk
    foreign key (topic_id, user_id) references public.topics (id, user_id) on delete cascade,
  -- The task may go; the material stays with the topic.
  constraint attachments_task_fk
    foreign key (task_id, user_id) references public.tasks (id, user_id) on delete set null (task_id),
  constraint attachments_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint attachments_shape check (
    (kind = 'link' and url is not null and storage_path is null and mime_type is null and size_bytes is null)
    or (kind = 'file' and url is null and storage_path is not null and mime_type is not null and size_bytes is not null)
  ),
  constraint attachments_url_web check (
    url is null or (char_length(url) <= 2048 and url ~* '^https?://[^[:space:]/?#]+([/?#][^[:space:]]*)?$')
  ),
  constraint attachments_path_owned check (storage_path is null or storage_path like user_id::text || '/%'),
  constraint attachments_mime check (
    mime_type is null or mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  ),
  constraint attachments_size check (size_bytes is null or size_bytes between 1 and 20971520)  -- 20 MB
);

create index attachments_task_idx on public.attachments (task_id) where task_id is not null;
create index attachments_topic_idx on public.attachments (topic_id, created_at desc);
create index attachments_user_idx on public.attachments (user_id);

alter table public.attachments enable row level security;

create policy "attachments_select_own" on public.attachments
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "attachments_insert_own" on public.attachments
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "attachments_update_own" on public.attachments
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "attachments_delete_own" on public.attachments
  for delete to authenticated using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- The bucket: private, one folder per user, 20 MB a file, 300 MB a student.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments', 'attachments', false, 20971520,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

/** Bytes a student's folder holds right now, as storage measured them. */
create or replace function public.attachment_bytes_used(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(coalesce((o.metadata ->> 'size')::bigint, 0)), 0)::bigint
    from storage.objects o
   where o.bucket_id = 'attachments'
     and o.name like p_user::text || '/%'
$$;

revoke execute on function public.attachment_bytes_used(uuid) from public, anon, authenticated;

/** The caller's own usage: what the upload policy asks before letting a file in. */
create or replace function public.attachment_space_used()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select public.attachment_bytes_used((select auth.uid()))
$$;

revoke execute on function public.attachment_space_used() from public, anon;
grant execute on function public.attachment_space_used() to authenticated;

create policy "attachment_files_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- A full folder takes no new file; the one that crosses the line still fits.
create policy "attachment_files_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.attachment_space_used() < 314572800  -- 300 MB
  );

create policy "attachment_files_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- -----------------------------------------------------------------------------
-- A row tells the truth about its file and its topic.
-- -----------------------------------------------------------------------------
create or replace function public.attachments_prepare()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topic uuid;
  v_size  bigint;
  v_mime  text;
begin
  if tg_op = 'UPDATE' then
    -- Only the name (and a link's address) is the student's to change; the
    -- task link may only be let go of, which is what deleting the task does.
    if new.user_id is distinct from old.user_id
       or new.kind is distinct from old.kind
       or new.storage_path is distinct from old.storage_path
       or new.mime_type is distinct from old.mime_type
       or new.size_bytes is distinct from old.size_bytes
       or new.created_at is distinct from old.created_at
       or (new.task_id is distinct from old.task_id and new.task_id is not null) then
      raise exception 'Bir ekin yalnızca adı ya da bağlantısı değiştirilebilir.' using errcode = '23514';
    end if;
    new.updated_at := now();
  end if;

  -- A task's attachment sits on that task's topic, whatever the phone sent.
  if new.task_id is not null then
    select t.topic_id into v_topic
      from public.tasks t
     where t.id = new.task_id and t.user_id = new.user_id;
    if not found then
      raise exception 'task % not found', new.task_id using errcode = '23503';
    end if;
    new.topic_id := v_topic;
  end if;

  if tg_op = 'INSERT' then
    new.title := btrim(regexp_replace(new.title, '[[:space:]]+', ' ', 'g'));

    if new.kind = 'file' then
      select (o.metadata ->> 'size')::bigint, split_part(o.metadata ->> 'mimetype', ';', 1)
        into v_size, v_mime
        from storage.objects o
       where o.bucket_id = 'attachments' and o.name = new.storage_path;
      if not found then
        raise exception 'Dosya henüz yüklenmemiş.' using errcode = '23503';
      end if;
      -- What storage measured wins over what the phone said.
      if v_size is not null then
        new.size_bytes := least(v_size, 2147483647)::integer;
      end if;
      if nullif(v_mime, '') is not null then
        new.mime_type := lower(v_mime);
      end if;
    end if;

    if new.task_id is not null
       and (select count(*) from public.attachments a
             where a.task_id = new.task_id and a.user_id = new.user_id) >= 30 then
      raise exception 'Bir göreve en fazla 30 ek eklenebilir.' using errcode = '23514';
    end if;
    if (select count(*) from public.attachments a
         where a.topic_id = new.topic_id and a.user_id = new.user_id) >= 200 then
      raise exception 'Bir konuya en fazla 200 ek eklenebilir.' using errcode = '23514';
    end if;
  elsif new.title is distinct from old.title then
    new.title := btrim(regexp_replace(new.title, '[[:space:]]+', ' ', 'g'));
  end if;

  return new;
end;
$$;

create trigger attachments_prepare
  before insert or update on public.attachments
  for each row execute function public.attachments_prepare();

-- A task moved to another topic takes its material along.
create or replace function public.tasks_carry_attachments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.attachments
     set topic_id = new.topic_id
   where task_id = new.id and user_id = new.user_id and topic_id is distinct from new.topic_id;
  return null;
end;
$$;

create trigger tasks_carry_attachments
  after update of topic_id on public.tasks
  for each row
  when (old.topic_id is distinct from new.topic_id)
  execute function public.tasks_carry_attachments();

-- -----------------------------------------------------------------------------
-- What storage still holds for deleted rows; emptied by the app.
-- No foreign key to profiles: an account being deleted must not be held up by
-- the trash its own deletion fills.
-- -----------------------------------------------------------------------------
create table public.storage_trash (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  bucket      text not null,
  path        text not null,
  created_at  timestamptz not null default now(),

  constraint storage_trash_object_key unique (bucket, path),
  constraint storage_trash_path_owned check (path like user_id::text || '/%')
);

create index storage_trash_user_idx on public.storage_trash (user_id, id);

alter table public.storage_trash enable row level security;

-- Read and cleared by its owner; only the trigger below writes it.
create policy "storage_trash_select_own" on public.storage_trash
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "storage_trash_delete_own" on public.storage_trash
  for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.attachments_trash_file()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.kind = 'file' then
    insert into public.storage_trash (user_id, bucket, path)
    values (old.user_id, 'attachments', old.storage_path)
    on conflict (bucket, path) do nothing;
  end if;
  return old;
end;
$$;

create trigger attachments_trash_file
  after delete on public.attachments
  for each row execute function public.attachments_trash_file();

-- -----------------------------------------------------------------------------
-- What a task's screen lists, nearest first:
--   task    added to this task;
--   group   added to its container, its steps or its sibling steps;
--   source  the check-in file this task was read out of (read-only here);
--   topic   everything else on the same topic, including material whose task
--           has since been deleted.
-- Runs as the caller: RLS decides what exists.
-- -----------------------------------------------------------------------------
create or replace function public.task_materials(p_task_id uuid)
returns table (
  id           uuid,
  kind         public.attachment_kind,
  title        text,
  url          text,
  bucket       text,
  storage_path text,
  mime_type    text,
  size_bytes   integer,
  created_at   timestamptz,
  relation     text,
  task_id      uuid,
  task_title   text,
  editable     boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with me as (
    select t.id, t.topic_id, t.parent_task_id, t.source, t.origin_daily_log_id
      from public.tasks t
     where t.id = p_task_id
  ),
  family as (
    select t.id
      from public.tasks t, me
     where t.id <> me.id
       and (t.id = me.parent_task_id
            or t.parent_task_id = me.id
            or (me.parent_task_id is not null and t.parent_task_id = me.parent_task_id))
  ),
  listed as (
    select a.id, a.kind, a.title, a.url,
           case when a.kind = 'file' then 'attachments' end as bucket,
           a.storage_path, a.mime_type, a.size_bytes, a.created_at,
           case
             when a.task_id = me.id then 'task'
             when a.task_id in (select f.id from family f) then 'group'
             else 'topic'
           end as relation,
           a.task_id, owner_task.title as task_title, true as editable
      from me
      join public.attachments a
        on a.task_id = me.id
        or a.task_id in (select f.id from family f)
        or a.topic_id = me.topic_id
      left join public.tasks owner_task on owner_task.id = a.task_id
    union all
    select d.id, 'file'::public.attachment_kind, d.original_filename, null::text,
           'checkin-attachments', d.storage_path, d.mime_type, d.size_bytes, d.created_at,
           'source', null::uuid, null::text, false
      from me
      join public.daily_log_attachments d on d.daily_log_id = me.origin_daily_log_id
     where me.source = 'ai_attachment'
  )
  select l.id, l.kind, l.title, l.url, l.bucket, l.storage_path, l.mime_type, l.size_bytes,
         l.created_at, l.relation, l.task_id, l.task_title, l.editable
    from listed l
   order by case l.relation when 'task' then 0 when 'group' then 1 when 'source' then 2 else 3 end,
            l.created_at desc
$$;

revoke execute on function public.task_materials(uuid) from public, anon;
grant execute on function public.task_materials(uuid) to authenticated;

-- Everything a topic has gathered, for the topic's own screen: material added
-- to it directly, through any of its tasks, and the check-in files its tasks
-- were read out of.
create or replace function public.topic_materials(p_topic_id uuid)
returns table (
  id           uuid,
  kind         public.attachment_kind,
  title        text,
  url          text,
  bucket       text,
  storage_path text,
  mime_type    text,
  size_bytes   integer,
  created_at   timestamptz,
  relation     text,
  task_id      uuid,
  task_title   text,
  editable     boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with listed as (
    select a.id, a.kind, a.title, a.url,
           case when a.kind = 'file' then 'attachments' end as bucket,
           a.storage_path, a.mime_type, a.size_bytes, a.created_at,
           case when a.task_id is null then 'topic' else 'task' end as relation,
           a.task_id, t.title as task_title, true as editable
      from public.attachments a
      left join public.tasks t on t.id = a.task_id
     where a.topic_id = p_topic_id
    union all
    select s.* from (
      select distinct on (d.id)
             d.id, 'file'::public.attachment_kind as kind, d.original_filename as title, null::text as url,
             'checkin-attachments' as bucket, d.storage_path, d.mime_type, d.size_bytes, d.created_at,
             'source' as relation, t.id as task_id, t.title as task_title, false as editable
        from public.tasks t
        join public.daily_log_attachments d on d.daily_log_id = t.origin_daily_log_id
       where t.topic_id = p_topic_id and t.source = 'ai_attachment'
       order by d.id, t.created_at
    ) s
  )
  select l.id, l.kind, l.title, l.url, l.bucket, l.storage_path, l.mime_type, l.size_bytes,
         l.created_at, l.relation, l.task_id, l.task_title, l.editable
    from listed l
   order by case l.relation when 'source' then 1 else 0 end, l.created_at desc
$$;

revoke execute on function public.topic_materials(uuid) from public, anon;
grant execute on function public.topic_materials(uuid) to authenticated;
