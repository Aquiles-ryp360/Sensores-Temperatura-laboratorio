#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ENV_FILE="${SCRIPT_DIR}/../web/.env"

if [[ -f "$WEB_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$WEB_ENV_FILE"
  set +a
fi

SUPABASE_PROJECT_URL="${SUPABASE_PROJECT_URL:-${VITE_SUPABASE_URL:-${NEXT_PUBLIC_SUPABASE_URL:-}}}"
SUPABASE_REST_URL="${SUPABASE_REST_URL:-}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-${VITE_SUPABASE_ANON_KEY:-${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}}}"
SENSOR_ID="${SENSOR_ID:-pecera_1}"

if [[ -z "$SUPABASE_REST_URL" && -n "$SUPABASE_PROJECT_URL" ]]; then
  SUPABASE_REST_URL="${SUPABASE_PROJECT_URL%/}/rest/v1/temperaturas"
fi

if [[ -z "$SUPABASE_REST_URL" || -z "$SUPABASE_ANON_KEY" ]]; then
  cat <<'EOF' >&2
Faltan variables para simular la lectura.
Define SUPABASE_REST_URL y SUPABASE_ANON_KEY, o usa VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en web/.env.
EOF
  exit 1
fi

valor_temp=$(awk -v r="$RANDOM" 'BEGIN { printf "%.2f", 24 + (r / 32767) * 2 }')
payload=$(printf '{"valor_temp": %s, "sensor_id": "%s"}' "$valor_temp" "$SENSOR_ID")

curl --fail-with-body -sS -X POST "$SUPABASE_REST_URL" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "$payload" \
  >/dev/null

printf 'Lectura simulada enviada: %s C para %s\n' "$valor_temp" "$SENSOR_ID"
