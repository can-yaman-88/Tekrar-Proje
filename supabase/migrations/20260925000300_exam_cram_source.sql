-- Work created by exam mode. Kept in its own migration because Postgres will
-- not let a new enum value be used in the transaction that adds it.
alter type public.task_source add value if not exists 'exam_cram';
