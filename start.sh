#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 0 ]]; then
  echo "Usage: ./start.sh (configuration is read from frontend/.env.development and backend/.env)" >&2
  exit 1
fi

SSR_DIR="vis-ssr"
SSR_ENV_FILE="${SSR_DIR}/.env"
SSR_ENV_TEMPLATE="${SSR_DIR}/.env.ssr.example"
BACKEND_ENV_FILE="backend/.env"

is_number() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

read_env_var() {
  local file="$1"
  local key="$2"

  ENV_FILE="$file" ENV_KEY="$key" python3 <<'PY'
import os
from pathlib import Path

path = Path(os.environ["ENV_FILE"])
key = os.environ["ENV_KEY"]
value = ""

if path.exists():
    for raw in path.read_text().splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        name, val = stripped.split("=", 1)
        if name.strip() == key:
            val = val.strip()
            if (
                (val.startswith('"') and val.endswith('"'))
                or (val.startswith("'") and val.endswith("'"))
            ):
                val = val[1:-1]
            value = val
            break

print(value)
PY
}

parse_url_components() {
  local url="$1"

  URL_VALUE="$url" python3 <<'PY'
import os
import sys
from urllib.parse import urlparse

raw = os.environ["URL_VALUE"].strip()
if not raw:
    print("ERROR", file=sys.stderr)
    sys.exit(1)

parsed = urlparse(raw)
host = parsed.hostname
port = parsed.port
scheme = parsed.scheme

if host is None:
    print("ERROR", file=sys.stderr)
    sys.exit(1)

if port is None:
    if scheme == "https":
        port = 443
    elif scheme == "http":
        port = 80
    else:
        print("ERROR", file=sys.stderr)
        sys.exit(1)

print(f"{host} {port} {scheme or ''}")
PY
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: Required command '$1' not found in PATH." >&2
    exit 1
  fi
}

free_port() {
  local port="$1"
  local pids

  pids=$(lsof -ti tcp:"$port" || true)

  if [[ -z "$pids" ]]; then
    return
  fi

  # shellcheck disable=SC2206 # intentional word splitting into array
  local pid_array=($pids)

  echo "[start] Terminating processes on port $port: ${pid_array[*]}"
  kill "${pid_array[@]}" >/dev/null 2>&1 || true
  sleep 1

  pids=$(lsof -ti tcp:"$port" || true)
  if [[ -z "$pids" ]]; then
    return
  fi

  pid_array=($pids)

  echo "[start] Forcing termination on port $port: ${pid_array[*]}"
  kill -9 "${pid_array[@]}" >/dev/null 2>&1 || true
  sleep 1
}

cleanup() {
  local code=$?

  if [[ -n "${SSR_PID:-}" ]] && kill -0 "$SSR_PID" >/dev/null 2>&1; then
    echo "[start] Stopping GPT-Vis SSR (PID $SSR_PID)"
    kill "$SSR_PID" >/dev/null 2>&1 || true
    wait "$SSR_PID" 2>/dev/null || true
  fi

  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    echo "[start] Stopping backend (PID $BACKEND_PID)"
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi

  if [[ -n "${FRONTEND_PID:-}" ]] && kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    echo "[start] Stopping frontend (PID $FRONTEND_PID)"
    kill "$FRONTEND_PID" >/dev/null 2>&1 || true
    wait "$FRONTEND_PID" 2>/dev/null || true
  fi

  exit "$code"
}

trap cleanup EXIT INT TERM

for cmd in lsof uv npm python3 curl node; do
  require_command "$cmd"
done

if [[ ! -f "$BACKEND_ENV_FILE" ]]; then
  echo "ERROR: Backend configuration '$BACKEND_ENV_FILE' not found." >&2
  exit 1
fi

CONTAINER_RUNTIME_RAW="$(read_env_var "$BACKEND_ENV_FILE" "CONTAINER_RUNTIME")"

if [[ -z "$CONTAINER_RUNTIME_RAW" ]]; then
  echo "ERROR: CONTAINER_RUNTIME must be defined in '$BACKEND_ENV_FILE'." >&2
  exit 1
fi

# macOS ships Bash 3.2 (no ${var,,}); use POSIX tr instead
CONTAINER_RUNTIME="$(printf '%s' "$CONTAINER_RUNTIME_RAW" | tr '[:upper:]' '[:lower:]')"

case "$CONTAINER_RUNTIME" in
  docker|podman)
    ;;
  *)
    echo "ERROR: Unsupported CONTAINER_RUNTIME '$CONTAINER_RUNTIME_RAW'. Use 'docker' or 'podman'." >&2
    exit 1
    ;;
esac

require_command "$CONTAINER_RUNTIME"
echo "[start] Container runtime -> $CONTAINER_RUNTIME"

BACKEND_DEV_URL="$(read_env_var "$BACKEND_ENV_FILE" "BACKEND_DEV_URL")"
if [[ -z "$BACKEND_DEV_URL" ]]; then
  echo "ERROR: BACKEND_DEV_URL must be defined in '$BACKEND_ENV_FILE'." >&2
  exit 1
fi

if ! read -r BACKEND_HOST BACKEND_PORT BACKEND_SCHEME < <(parse_url_components "$BACKEND_DEV_URL"); then
  echo "ERROR: Unable to parse BACKEND_DEV_URL '$BACKEND_DEV_URL'." >&2
  exit 1
fi

if ! is_number "$BACKEND_PORT"; then
  echo "ERROR: BACKEND_DEV_URL must include a numeric port. Got '$BACKEND_DEV_URL'." >&2
  exit 1
fi
if [[ "${BACKEND_SCHEME:-}" == "https" ]]; then
  echo "[start] WARNING: BACKEND_DEV_URL uses https; start.sh launches uvicorn without TLS certificates." >&2
fi

FRONTEND_ENV_FILE="frontend/.env.development"

if [[ ! -f "$FRONTEND_ENV_FILE" ]]; then
  echo "ERROR: Frontend configuration '$FRONTEND_ENV_FILE' not found. Copy 'frontend/.env.development.example' and update it." >&2
  exit 1
fi

FRONTEND_DEV_URL="$(read_env_var "$FRONTEND_ENV_FILE" "FRONTEND_DEV_URL")"

if [[ -z "$FRONTEND_DEV_URL" ]]; then
  echo "ERROR: FRONTEND_DEV_URL must be defined in '$FRONTEND_ENV_FILE'." >&2
  exit 1
fi

if ! read -r FRONTEND_HOST FRONTEND_PORT FRONTEND_SCHEME < <(parse_url_components "$FRONTEND_DEV_URL"); then
  echo "ERROR: Unable to parse FRONTEND_DEV_URL '$FRONTEND_DEV_URL'." >&2
  exit 1
fi

if ! is_number "$FRONTEND_PORT"; then
  echo "ERROR: FRONTEND_DEV_URL must include a numeric port. Got '$FRONTEND_DEV_URL'." >&2
  exit 1
fi
if [[ "${FRONTEND_SCHEME:-}" == "https" ]]; then
  echo "[start] WARNING: FRONTEND_DEV_URL uses https; Vite dev server will run without TLS." >&2
fi

VITE_API_URL_VALUE="$(read_env_var "$FRONTEND_ENV_FILE" "VITE_API_URL")"

if [[ -z "$VITE_API_URL_VALUE" ]]; then
  echo "ERROR: VITE_API_URL must be defined in '$FRONTEND_ENV_FILE'." >&2
  exit 1
fi

CUSTOM_FRONTEND_URLS="$(read_env_var "$FRONTEND_ENV_FILE" "FRONTEND_URLS")"

if [[ -n "$CUSTOM_FRONTEND_URLS" ]]; then
  ALLOWED_ORIGINS_VALUE="$CUSTOM_FRONTEND_URLS"
  echo "[start] frontend origin(s) from $FRONTEND_ENV_FILE -> $ALLOWED_ORIGINS_VALUE"
else
  ALLOWED_ORIGINS_VALUE="$FRONTEND_DEV_URL"
  echo "[start] frontend origin default -> $ALLOWED_ORIGINS_VALUE"
fi

echo "[start] frontend dev server -> $FRONTEND_DEV_URL"
echo "[start] backend dev server -> $BACKEND_DEV_URL"
echo "[start] frontend/.env.development -> VITE_API_URL=$VITE_API_URL_VALUE"
echo "[start] backend CORS -> ALLOWED_ORIGINS=$ALLOWED_ORIGINS_VALUE"

# MindsDB container configuration (from backend/.env)
MINDSDB_CONTAINER_NAME="$(read_env_var "$BACKEND_ENV_FILE" "MINDSDB_CONTAINER_NAME")"
if [[ -z "$MINDSDB_CONTAINER_NAME" ]]; then
  echo "ERROR: MINDSDB_CONTAINER_NAME must be defined in '$BACKEND_ENV_FILE'." >&2
  exit 1
fi

MINDSDB_HTTP_PORT="$(read_env_var "$BACKEND_ENV_FILE" "MINDSDB_HTTP_PORT")"
MINDSDB_MYSQL_PORT="$(read_env_var "$BACKEND_ENV_FILE" "MINDSDB_MYSQL_PORT")"

if [[ -z "$MINDSDB_HTTP_PORT" || -z "$MINDSDB_MYSQL_PORT" ]]; then
  echo "ERROR: MINDSDB_HTTP_PORT and MINDSDB_MYSQL_PORT must be defined in '$BACKEND_ENV_FILE'." >&2
  exit 1
fi

if ! is_number "$MINDSDB_HTTP_PORT" || ! is_number "$MINDSDB_MYSQL_PORT"; then
  echo "ERROR: MINDSDB_HTTP_PORT and MINDSDB_MYSQL_PORT must be numeric. Got HTTP='$MINDSDB_HTTP_PORT' MYSQL='$MINDSDB_MYSQL_PORT'." >&2
  exit 1
fi

MINDSDB_BASE_URL_VAL="$(read_env_var "$BACKEND_ENV_FILE" "MINDSDB_BASE_URL")"
if [[ -z "$MINDSDB_BASE_URL_VAL" ]]; then
  echo "ERROR: MINDSDB_BASE_URL must be defined in '$BACKEND_ENV_FILE'." >&2
  exit 1
fi

if ! read -r MINDSDB_HOST_FROM_URL MINDSDB_PORT_FROM_URL MINDSDB_SCHEME_FROM_URL < <(parse_url_components "$MINDSDB_BASE_URL_VAL"); then
  echo "ERROR: Unable to parse MINDSDB_BASE_URL '$MINDSDB_BASE_URL_VAL'." >&2
  exit 1
fi

if ! is_number "$MINDSDB_PORT_FROM_URL"; then
  echo "ERROR: MINDSDB_BASE_URL must include a numeric port. Got '$MINDSDB_BASE_URL_VAL'." >&2
  exit 1
fi

if [[ "$MINDSDB_PORT_FROM_URL" -ne "$MINDSDB_HTTP_PORT" ]]; then
  echo "ERROR: MINDSDB_BASE_URL port ($MINDSDB_PORT_FROM_URL) must match MINDSDB_HTTP_PORT ($MINDSDB_HTTP_PORT)." >&2
  exit 1
fi

echo "[start] mindsdb container -> $MINDSDB_CONTAINER_NAME (http:$MINDSDB_HTTP_PORT mysql:$MINDSDB_MYSQL_PORT)"

MINDSDB_RUNNING_ALREADY=false
if "$CONTAINER_RUNTIME" inspect -f '{{.State.Running}}' "$MINDSDB_CONTAINER_NAME" >/dev/null 2>&1; then
  if "$CONTAINER_RUNTIME" inspect -f '{{.State.Running}}' "$MINDSDB_CONTAINER_NAME" | grep -q "true"; then
    MINDSDB_RUNNING_ALREADY=true
    echo "[start] Reusing existing MindsDB container (already running)"
  fi
fi

# Embeddings configuration visibility and validation
EMBED_CFG_PATH="$(read_env_var "$BACKEND_ENV_FILE" "MINDSDB_EMBEDDINGS_CONFIG_PATH")"
if [[ -n "$EMBED_CFG_PATH" ]]; then
  if [[ "$EMBED_CFG_PATH" != /* ]]; then
    EMBED_CFG_PATH="$(cd "$(dirname "$BACKEND_ENV_FILE")" && pwd)/$EMBED_CFG_PATH"
  fi
  echo "[start] embeddings config -> $EMBED_CFG_PATH"
  if [[ ! -f "$EMBED_CFG_PATH" ]]; then
    echo "ERROR: MINDSDB_EMBEDDINGS_CONFIG_PATH points to a missing file: $EMBED_CFG_PATH" >&2
    exit 1
  fi
else
  echo "[start] embeddings config -> (disabled)"
fi

for port in "$FRONTEND_PORT" "$BACKEND_PORT" "$MINDSDB_HTTP_PORT" "$MINDSDB_MYSQL_PORT"; do
  if ! is_number "$port"; then
    echo "ERROR: Ports must be numeric. Got '$port'." >&2
    exit 1
  fi
  if [[ "$MINDSDB_RUNNING_ALREADY" == "true" && ( "$port" -eq "$MINDSDB_HTTP_PORT" || "$port" -eq "$MINDSDB_MYSQL_PORT" ) ]]; then
    echo "[start] Skipping port $port (MindsDB already running)"
    continue
  fi
  free_port "$port"
done

if [[ ! -d "$SSR_DIR" ]]; then
  echo "ERROR: SSR directory '$SSR_DIR' is missing." >&2
  exit 1
fi

if [[ ! -f "$SSR_ENV_FILE" ]]; then
  echo "ERROR: GPT-Vis SSR configuration '$SSR_ENV_FILE' not found. Copy '$SSR_ENV_TEMPLATE' and set GPT_VIS_SSR_PORT." >&2
  exit 1
fi

SSR_PORT="$(read_env_var "$SSR_ENV_FILE" "GPT_VIS_SSR_PORT")"

if [[ -z "$SSR_PORT" ]]; then
  echo "ERROR: GPT_VIS_SSR_PORT must be defined in '$SSR_ENV_FILE'." >&2
  exit 1
fi

if ! is_number "$SSR_PORT"; then
  echo "ERROR: GPT_VIS_SSR_PORT must be numeric. Got '$SSR_PORT'." >&2
  exit 1
fi

free_port "$SSR_PORT"

ensure_mindsdb() {
  local container="$MINDSDB_CONTAINER_NAME"

  if "$CONTAINER_RUNTIME" ps -a --filter "name=^${container}$" --format '{{.Names}}' | grep -q .; then
    if "$CONTAINER_RUNTIME" inspect -f '{{.State.Running}}' "$container" | grep -q "true"; then
      echo "[start] MindsDB container '$container' already running, reusing it"
      "$CONTAINER_RUNTIME" ps --filter "name=^${container}$" --format '  -> {{.ID}} {{.Status}} {{.Ports}}' || true
      echo "[start] MindsDB last logs (tail 10)"
      "$CONTAINER_RUNTIME" logs --tail 10 "$container" 2>/dev/null | sed 's/^/[mindsdb] /' || true
      return
    fi
    echo "[start] Starting existing MindsDB container '$container'"
    "$CONTAINER_RUNTIME" start "$container" >/dev/null
    "$CONTAINER_RUNTIME" ps --filter "name=^${container}$" --format '  -> {{.ID}} {{.Status}} {{.Ports}}' || true
    echo "[start] MindsDB last logs (tail 10)"
    "$CONTAINER_RUNTIME" logs --tail 10 "$container" 2>/dev/null | sed 's/^/[mindsdb] /' || true
    return
  fi

  echo "[start] Launching MindsDB container '$container'"
  "$CONTAINER_RUNTIME" run -d --name "$container" \
    -e MINDSDB_APIS=http,mysql \
    -p "$MINDSDB_HTTP_PORT":47334 -p "$MINDSDB_MYSQL_PORT":47335 \
    mindsdb/mindsdb >/dev/null

  echo "[start] MindsDB container '$container' status"
  "$CONTAINER_RUNTIME" ps --filter "name=^${container}$" --format '  -> {{.ID}} {{.Status}} {{.Ports}}' || true
  echo "[start] MindsDB last logs (tail 10)"
  "$CONTAINER_RUNTIME" logs --tail 10 "$container" 2>/dev/null | sed 's/^/[mindsdb] /' || true
}

wait_for_mindsdb() {
  local max_wait=60
  local elapsed=0
  local url="http://127.0.0.1:${MINDSDB_HTTP_PORT}/api/status"

  echo "[start] Waiting for MindsDB to be ready..."

  while [[ $elapsed -lt $max_wait ]]; do
    if curl -sf "$url" >/dev/null 2>&1; then
      echo "[start] MindsDB is ready!"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
    echo "[start] Still waiting for MindsDB... (${elapsed}s)"
  done

  echo "[start] WARNING: MindsDB did not become ready after ${max_wait}s"
  return 1
}

ensure_mindsdb
wait_for_mindsdb

echo "[start] Ensuring backend dependencies (uv sync)"
(
  cd backend
  uv sync
)

echo "[start] Syncing local tables into MindsDB"
(
  cd backend
  uv run python - <<'PY'
from insight_backend.services.mindsdb_sync import sync_all_tables

uploaded = sync_all_tables()
if uploaded:
    print("[start] MindsDB sync uploaded:", ", ".join(uploaded))
else:
    print("[start] MindsDB sync uploaded: (aucun fichier)")
PY
)

echo "[start] Verifying MindsDB tables (row counts)"
(
  cd backend
  uv run -m insight_backend.scripts.verify_mindsdb
)

if [[ ! -d frontend/node_modules ]]; then
  echo "[start] Installing frontend dependencies (npm install)"
  (
    cd frontend
    npm install
  )
else
  echo "[start] Frontend dependencies already installed"
fi

if [[ ! -f "${SSR_DIR}/package.json" ]]; then
  echo "ERROR: Missing package.json in '$SSR_DIR'." >&2
  exit 1
fi

if [[ ! -d ${SSR_DIR}/node_modules ]]; then
  echo "[start] Installing GPT-Vis SSR dependencies (npm install)"
  (
    cd "$SSR_DIR"
    NODE_TLS_REJECT_UNAUTHORIZED=0 npm_config_strict_ssl=false npm_config_registry=https://registry.npmjs.org npm install
  )
else
  echo "[start] GPT-Vis SSR dependencies already installed"
fi

SSR_IMAGE_DIR="$(read_env_var "$SSR_ENV_FILE" "VIS_IMAGE_DIR")"
if [[ -n "$SSR_IMAGE_DIR" ]]; then
  echo "[start] GPT-Vis SSR images -> $SSR_IMAGE_DIR"
else
  SSR_IMAGE_DIR_DISPLAY="$(cd "$SSR_DIR" && pwd)/charts"
  echo "[start] GPT-Vis SSR images -> $SSR_IMAGE_DIR_DISPLAY (default)"
fi

echo "[start] Launching GPT-Vis SSR on port $SSR_PORT"
(
  cd "$SSR_DIR"
  if [[ -n "$SSR_IMAGE_DIR" ]]; then
    GPT_VIS_SSR_PORT="$SSR_PORT" VIS_IMAGE_DIR="$SSR_IMAGE_DIR" exec npm run start
  else
    GPT_VIS_SSR_PORT="$SSR_PORT" exec npm run start
  fi
) &
SSR_PID=$!

echo "[start] Launching backend on ${BACKEND_HOST}:${BACKEND_PORT}"
(
  cd backend
  ALLOWED_ORIGINS="$ALLOWED_ORIGINS_VALUE" exec uv run uvicorn insight_backend.main:app --reload --host "$BACKEND_HOST" --port "$BACKEND_PORT"
) &
BACKEND_PID=$!

# Allow backend to initialise before starting frontend
sleep 1

echo "[start] Building frontend (no watchers, mode=development)"
(
  cd frontend
  npm run build -- --mode development >/dev/null
)

echo "[start] Serving frontend (preview) on ${FRONTEND_HOST}:${FRONTEND_PORT}"
(
  cd frontend
  exec npm run preview -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT"
) &
FRONTEND_PID=$!

wait "$BACKEND_PID"
wait "$FRONTEND_PID"
wait "$SSR_PID"
