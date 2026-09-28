#!/usr/bin/env bash
# Builds the standalone release APK against the hosted project.
#
#   scripts/build-apk.sh            → .env.production okunur
#   scripts/build-apk.sh --local    → .env okunur, şifresiz HTTP'ye izin verilir
#
# The JavaScript bundle is embedded, so the phone needs no computer running.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env.production"
ALLOW_CLEARTEXT=0
if [[ "${1:-}" == "--local" ]]; then
  ENV_FILE=".env"
  ALLOW_CLEARTEXT=1
fi

[[ -f "$ENV_FILE" ]] || { echo "✖ $ENV_FILE yok. .env.production.example dosyasını kopyala."; exit 1; }

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${EXPO_PUBLIC_SUPABASE_URL:?EXPO_PUBLIC_SUPABASE_URL tanımlı değil}"
: "${EXPO_PUBLIC_SUPABASE_ANON_KEY:?EXPO_PUBLIC_SUPABASE_ANON_KEY tanımlı değil}"

if [[ "$ALLOW_CLEARTEXT" == "0" && "$EXPO_PUBLIC_SUPABASE_URL" != https://* ]]; then
  echo "✖ Yayın derlemesi HTTPS bekler: $EXPO_PUBLIC_SUPABASE_URL"
  echo "  Yerel sunucuya bağlanacaksan: scripts/build-apk.sh --local"
  exit 1
fi

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk}"
export TEKRAR_ALLOW_CLEARTEXT="$ALLOW_CLEARTEXT"

echo "→ Yapılandırma: $EXPO_PUBLIC_SUPABASE_URL (cleartext=$ALLOW_CLEARTEXT)"
npx expo prebuild --platform android
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

echo "→ Derleme"
(cd android && ./gradlew assembleRelease --console=plain)

APK="android/app/build/outputs/apk/release/app-release.apk"
echo "✓ Hazır: $APK"
echo "  Telefona kur: adb install -r $APK"
