-- The study loop the student actually follows, as first-class task types.
-- Kept in its own migration: Postgres forbids using a new enum value in the
-- same transaction that adds it.
--   concept_note       → konsept sayfasına ekleme (bağlantılar, oklar, örnekler)
--   quiz               → 10 soruluk otomasyon sınavı (ya da hocanın materyali)
--   feynman            → boş kâğıda sıfırdan anlatma
--   advanced_problems  → yalnızca öğrenci "elimde var" dediğinde
alter type public.task_type add value if not exists 'concept_note';
alter type public.task_type add value if not exists 'quiz';
alter type public.task_type add value if not exists 'feynman';
alter type public.task_type add value if not exists 'advanced_problems';
