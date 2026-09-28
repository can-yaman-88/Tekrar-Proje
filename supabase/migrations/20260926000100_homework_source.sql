-- Work the student describes in their own words ("4 dersten 4 ödev var").
-- Its own migration because Postgres will not let a new enum value be used in
-- the transaction that adds it.
alter type public.task_source add value if not exists 'homework';
