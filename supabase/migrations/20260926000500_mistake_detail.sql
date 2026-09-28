-- =============================================================================
-- The mistake book keeps the student's own sentence.
--
-- The first version stored a label: "Mol kavramı". Weeks later that is almost
-- useless — the student knows the topic, what they have forgotten is what went
-- wrong inside it. So the row now carries both: a short label to group and
-- deduplicate by, and the detail in their own words, which is the part that
-- actually gets read before the next round.
-- =============================================================================
alter table public.topic_mistakes
  add column concept text check (concept is null or char_length(concept) between 2 and 120);

comment on column public.topic_mistakes.body is
  'What went wrong, in the student''s own words. This is what is shown back to them.';
comment on column public.topic_mistakes.concept is
  'Short label for grouping ("Mol hesapları"); never a replacement for the detail.';

-- Same slip, same words, still open → not news. A new detail under the same
-- label is a different slip and is kept.
create or replace function public.apply_checkin_mistakes(
  p_user_id       uuid,
  p_daily_log_id  uuid,
  p_mistakes      jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_added integer := 0;
begin
  with candidate as (
    select distinct on (m.topic_id, lower(btrim(m.body)))
           m.topic_id,
           btrim(m.body)    as body,
           nullif(btrim(coalesce(m.concept, '')), '') as concept,
           m.task_id
      from jsonb_to_recordset(coalesce(p_mistakes, '[]'::jsonb)) as m(topic_id uuid, body text, concept text, task_id uuid)
     where btrim(coalesce(m.body, '')) <> ''
  ),
  added as (
    insert into public.topic_mistakes (user_id, topic_id, body, concept, source_daily_log_id, task_id)
    select p_user_id, c.topic_id, left(c.body, 300), left(c.concept, 120), p_daily_log_id, c.task_id
      from candidate c
      join public.topics t on t.id = c.topic_id and t.user_id = p_user_id
     where not exists (
       select 1 from public.topic_mistakes existing
        where existing.user_id = p_user_id
          and existing.topic_id = c.topic_id
          and existing.resolved_at is null
          and lower(existing.body) = lower(left(c.body, 300))
     )
    returning 1
  )
  select count(*) into v_added from added;

  return v_added;
end;
$$;

revoke execute on function public.apply_checkin_mistakes(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_checkin_mistakes(uuid, uuid, jsonb) to service_role;
