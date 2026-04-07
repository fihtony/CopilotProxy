#!/usr/bin/env bash

PIDS_FILE=".running.pids"

# ── determine environment (dev or production) ──────────────────────────────
MODE="${1:-production}"
if [[ "$MODE" != "dev" && "$MODE" != "production" ]]; then
  echo "Usage: ./start.sh [dev|production]"
  echo "  dev         - local development mode (no Cloudflare auth required)"
  echo "  production  - production mode (Cloudflare auth required)"
  exit 1
fi

# ── load environment variables ─────────────────────────────────────────────
# Load .env file if it exists (suppress errors if it doesn't)
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

set -e

# Set defaults if not defined
COPILOT_URL=${COPILOT_URL:-"http://127.0.0.1:1288"}
ADMIN_PORT=${ADMIN_PORT:-8020}
CLIENT_PORT=${CLIENT_PORT:-8022}
UI_PORT=${UI_PORT:-3020}
DATABASE_PATH=${DATABASE_PATH:-"./data/copilot-proxy.db"}

# Set NODE_ENV based on mode
NODE_ENV=$([[ "$MODE" == "dev" ]] && echo "development" || echo "production")

# ── Dev mode: LOCAL_BYPASS_OAUTH_ALLOWED in .env ────────────────────────────
# The server reads this flag directly from .env on every write operation.
# Setting it only as a shell variable is not sufficient (by design).
# If not set to true, all write operations will be blocked with a permission error.
DEV_BYPASS_ENABLED="false"
if [[ "$MODE" == "dev" ]]; then
  if [[ "${LOCAL_BYPASS_OAUTH_ALLOWED}" == "true" ]]; then
    DEV_BYPASS_ENABLED="true"
  elif [[ -z "${LOCAL_BYPASS_OAUTH_ALLOWED}" ]]; then
    echo "⚠️  Warning: LOCAL_BYPASS_OAUTH_ALLOWED not set in .env (or not found)"
  fi
fi

# Convert DATABASE_PATH to absolute path from project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
if [[ "$DATABASE_PATH" != /* ]]; then
  DATABASE_PATH="$SCRIPT_DIR/$DATABASE_PATH"
fi

# Ensure data directory exists
DATA_DIR="$(dirname "$DATABASE_PATH")"
mkdir -p "$DATA_DIR" || {
  echo "❌ Failed to create data directory: $DATA_DIR"
  exit 1
}

# ── clean up from any previous run ──────────────────────────────────────────
> "$PIDS_FILE"
mkdir -p logs

MODE_LABEL=$([[ "$MODE" == "dev" ]] && echo "DEVELOPMENT (LOCAL_BYPASS_OAUTH_ALLOWED=true)" || echo "PRODUCTION (auth required)")
AUTH_LABEL=$([[ "$MODE" == "dev" ]] && echo "BYPASSED via LOCAL_BYPASS_OAUTH_ALLOWED=true in .env" || echo "ENABLED (CF-Access-JWT-Assertion required)")

echo "╔════════════════════════════════════════════════════════════╗"
echo "║         Copilot Proxy — Starting in $MODE_LABEL           "
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Configuration:"
echo "  Mode:              $MODE_LABEL"
echo "  Cloudflare Auth:   $AUTH_LABEL"
echo "  Copilot Connect:   $COPILOT_URL"
echo ""
echo "API Endpoints:"
echo "  /api/admin/*  — Admin API on port $ADMIN_PORT (for dashboard UI)"
echo "  /api/v1/*     — Client API on port $CLIENT_PORT (OpenAI-compatible, requires API key)"
echo ""

# ── install dependencies ─────────────────────────────────────────────────────
echo "▶ Installing root workspace dependencies..."
npm install --silent

echo ""

# ── build server & UI ────────────────────────────────────────────────────────
echo "▶ Building server..."
npm run build -w server --silent

echo "▶ Building UI..."
npm run build -w ui --silent

echo ""

# ── switch CopilotConnect to echo mode (if running and mode is dev) ─────────
if [[ "$MODE" == "dev" ]]; then
  echo "▶ Checking CopilotConnect at ${COPILOT_URL}..."
  if curl -sf "${COPILOT_URL}/health" > /dev/null 2>&1; then
    echo "▶ CopilotConnect is running — switching to echo mode..."
    curl -sf -X POST "${COPILOT_URL}/v1/mode" \
      -H "Content-Type: application/json" \
      -d '{"mode":"echo"}' > /dev/null 2>&1 && echo "  Echo mode enabled." || echo "  Warning: could not switch to echo mode."
  else
    echo "  Warning: CopilotConnect not reachable at ${COPILOT_URL}."
    echo "  Proxy will still start but upstream calls will fail until CopilotConnect is running."
  fi
  echo ""
fi

# ── start Copilot Proxy servers ──────────────────────────────────────────────
echo "▶ Starting Copilot Proxy servers..."
echo "  Admin API  → http://localhost:${ADMIN_PORT}"
echo "  Client API → http://localhost:${CLIENT_PORT}"
(cd server && NODE_ENV="$NODE_ENV" COPILOT_URL="$COPILOT_URL" ADMIN_PORT="$ADMIN_PORT" CLIENT_PORT="$CLIENT_PORT" DATABASE_PATH="$DATABASE_PATH" node dist/index.js > ../logs/server.log 2>&1) &
echo $! >> "$PIDS_FILE"

# ── start UI (Vite dev or preview; proxies /api/admin to 8020 only) ─────────
if [[ "$MODE" == "production" ]]; then
  echo "▶ Starting Admin UI on http://localhost:${UI_PORT}..."
  echo "  Tunnel: expose 3020 (UI + /api/admin proxy) and 8022 (/api/v1); 8020 is internal only."
  (cd ui && ADMIN_PORT="$ADMIN_PORT" npx vite preview --port "$UI_PORT" --host 127.0.0.1 > ../logs/ui.log 2>&1) &
else
  echo "▶ Starting Admin UI on http://localhost:${UI_PORT}..."
  (cd ui && ADMIN_PORT="$ADMIN_PORT" npx vite --port "$UI_PORT" > ../logs/ui.log 2>&1) &
fi
echo $! >> "$PIDS_FILE"

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║  All services are running ($MODE mode)                       ║"
echo "║                                                               ║"
echo "║   Copilot Connect       →  ${COPILOT_URL}          "
echo "║   Admin API             →  http://localhost:${ADMIN_PORT}    ║"
echo "║   Client API (proxy)    →  http://localhost:${CLIENT_PORT}   ║"
echo "║   Admin UI              →  http://localhost:${UI_PORT}       ║"
echo "║                                                               ║"
if [[ "$MODE" == "dev" ]]; then
  if [[ "$DEV_BYPASS_ENABLED" == "true" ]]; then
    echo "║  DEV MODE: Auth bypass ENABLED (LOCAL_BYPASS_OAUTH_ALLOWED=true)      ║"
    echo "║     - Write operations allowed. /api/v1/* require API key auth.   ║"
  else
    echo "║  ⚠️  DEV MODE: Auth bypass DISABLED (LOCAL_BYPASS_OAUTH_ALLOWED not set)   ║"
    echo "║     - Write operations will be BLOCKED with permission error      ║"
    echo "║     - Set LOCAL_BYPASS_OAUTH_ALLOWED=true in .env to enable      ║"
  fi
else
  echo "║  PROD MODE: Admin API (/api/admin/*) requires Cloudflare Access    ║"
  echo "║     - CF-Access-JWT-Assertion header required                ║"
  echo "║     - /api/v1/* endpoints require API key authentication         ║"
fi
echo "║                                                               ║"
echo "║  Logs:  ./logs/server.log          (NODE_ENV=$NODE_ENV)       ║"
echo "║         ./logs/ui.log                                         ║"
echo "║                                                               ║"
echo "║  Run ./stop.sh to stop all services.                          ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
