-- =============================================================================
-- A difficulty that was sorted out is not an open weakness.
--
-- "Molde takıldım ama sonra çözdüm" was being filed exactly like "molde
-- takıldım": the entry stayed open, the review interval dropped and a remedial
-- task appeared. The sentence is still worth keeping — it says what the topic
-- costs them — but it belongs in the record, not in the queue.
-- =============================================================================
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
           btrim(m.body) as body,
           nullif(btrim(coalesce(m.concept, '')), '') as concept,
           coalesce(m.resolved, false) as resolved,
           m.task_id
      from jsonb_to_recordset(coalesce(p_mistakes, '[]'::jsonb))
             as m(topic_id uuid, body text, concept text, resolved boolean, task_id uuid)
     where btrim(coalesce(m.body, '')) <> ''
  ),
  added as (
    insert into public.topic_mistakes
      (user_id, topic_id, body, concept, source_daily_log_id, task_id, resolved_at)
    select p_user_id, c.topic_id, left(c.body, 300), left(c.concept, 120), p_daily_log_id, c.task_id,
           case when c.resolved then now() end
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
