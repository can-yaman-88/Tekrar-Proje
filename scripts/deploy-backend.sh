#!/usr/bin/env bash
# Pushes everything the phone needs to the hosted Supabase project:
# schema, Edge Functions and their secrets.
#
#   scripts/deploy-backend.sh
#
# Requires an already linked project (supabase login && supabase link).
set -euo pipefail
cd "$(dirname "$0")/.."

FUNCTIONS=(daily-checkin ingest-syllabus generate-weekly-plan llm-models)
FUNCTION_ENV="supabase/functions/.env"

echo "→ Şema (migrations)"
npx supabase db push

echo "→ Edge Function sırları"
if [[ -f "$FUNCTION_ENV" ]]; then
  # Local-only keys stay out: the hosted project injects its own.
  grep -E '^(LLM_PROVIDER|LLM_MODEL|LLM_TIMEOUT_MS|OPENAI_API_KEY|OPENROUTER_API_KEY|GEMINI_API_KEY)=' "$FUNCTION_ENV" \
    > /tmp/tekrar-secrets.env
  npx supabase secrets set --env-file /tmp/tekrar-secrets.env
  rm -f /tmp/tekrar-secrets.env
else
  echo "  ⚠ $FUNCTION_ENV yok; sırları elle ayarla: npx supabase secrets set LLM_PROVIDER=... "
fi

echo "→ Edge Functions"
for fn in "${FUNCTIONS[@]}"; do
  echo "  · $fn"
  npx supabase functions deploy "$fn"
done

echo "✓ Backend yayında. Şimdi APK'yı üret: scripts/build-apk.sh"
