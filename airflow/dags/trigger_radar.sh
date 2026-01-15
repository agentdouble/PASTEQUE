#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Copy .env.example to .env and set the variables." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

echo "[radar] loaded env from ${ENV_FILE}"

require_env() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    echo "Missing required env var: $name" >&2
    exit 1
  fi
  echo "$value"
}

RADAR_API_BASE_URL="$(require_env RADAR_API_BASE_URL)"
RADAR_ADMIN_USERNAME="$(require_env RADAR_ADMIN_USERNAME)"
RADAR_ADMIN_PASSWORD="$(require_env RADAR_ADMIN_PASSWORD)"
RADAR_TABLE_NAME="${RADAR_TABLE_NAME:-}"
RADAR_TIMEOUT_S="${RADAR_TIMEOUT_S:-900}"

echo "[radar] login (table_name=${RADAR_TABLE_NAME:-ALL})"

LOGIN_PAYLOAD=$(RADAR_ADMIN_USERNAME="$RADAR_ADMIN_USERNAME" RADAR_ADMIN_PASSWORD="$RADAR_ADMIN_PASSWORD" \
  python3 - <<'PY'
import json
import os

payload = {
    "username": os.environ["RADAR_ADMIN_USERNAME"],
    "password": os.environ["RADAR_ADMIN_PASSWORD"],
}
print(json.dumps(payload))
PY
)
LOGIN_RESPONSE=$(curl -sS --fail --max-time "$RADAR_TIMEOUT_S" \
  -H "Content-Type: application/json" \
  -d "$LOGIN_PAYLOAD" \
  "${RADAR_API_BASE_URL%/}/auth/login")

read -r TOKEN TOKEN_TYPE < <(LOGIN_RESPONSE="$LOGIN_RESPONSE" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["LOGIN_RESPONSE"])
token = payload.get("access_token")
token_type = payload.get("token_type")
if not token or not token_type:
    raise SystemExit("Login response missing access_token or token_type.")
print(token, token_type)
PY
)

if [[ -n "$RADAR_TABLE_NAME" ]]; then
  TABLE_ENCODED=$(python3 - <<'PY'
import os
from urllib.parse import quote

name = os.environ["RADAR_TABLE_NAME"]
print(quote(name, safe=""))
PY
  )
  TARGET_URL="${RADAR_API_BASE_URL%/}/loop/regenerate?table_name=${TABLE_ENCODED}"
else
  TARGET_URL="${RADAR_API_BASE_URL%/}/loop/regenerate"
fi

curl -sS --fail --max-time "$RADAR_TIMEOUT_S" \
  -X POST \
  -H "Authorization: ${TOKEN_TYPE} ${TOKEN}" \
  "$TARGET_URL" >/dev/null

echo "[radar] regenerate done"
