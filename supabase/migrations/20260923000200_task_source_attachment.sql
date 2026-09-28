-- Tasks can now originate from a file attached to a daily check-in
-- (a homework PDF, a photo of a problem sheet).
-- Kept in its own migration: Postgres forbids using a new enum value in the
-- same transaction that adds it.
alter type public.task_source add value if not exists 'ai_attachment';
