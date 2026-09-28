-- =============================================================================
-- Per-user model choice.
--
-- The provider and its API key stay server-side; only the model id is a user
-- preference. Empty means "use the project default" (LLM_MODEL secret).
-- =============================================================================
alter table public.profiles
  add column llm_model text check (llm_model ~ '^[A-Za-z0-9._\-]+(/[A-Za-z0-9._\-:]+)*$' and char_length(llm_model) between 2 and 120);

comment on column public.profiles.llm_model is
  'OpenRouter/OpenAI model id chosen by the student, e.g. "google/gemini-2.5-flash". Null = project default.';
