#!/usr/bin/env bash
set -e

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
set -a
source .env 2>/dev/null || true
set +a

# Set defaults if not defined
COPILOT_URL=${COPILOT_URL:-"http://127.0.0.1:1288"}
ADMIN_PORT=${ADMIN_PORT:-8020}
CLIENT_PORT=${CLIENT_PORT:-8022}
UI_PORT=${UI_PORT:-3020}
DATABASE_PATH=${DATABASE_PATH:-"./data"}

# Set NODE_ENV based on mode
NODE_ENV=$([[ "$MODE" == "dev" ]] && echo "development" || echo "production")

# Convert DATABASE_PATH to absolute path from project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
if [[ "$DATABASE_PATH" != /* ]]; then
  DATABASE_PATH="$SCRIPT_DIR/$DATABASE_PATH"
fi

# ── clean up from any previous run ──────────────────────────────────────────
> "$PIDS_FILE"
mkdir -p logs

MODE_LABEL=$([[ "$MODE" == "dev" ]] && echo "DEVELOPMENT (no auth required)" || echo "PRODUCTION (auth required)")
AUTH_LABEL=$([[ "$MODE" == "dev" ]] && echo "DISABLED (CF-Access-JWT-Assertion not required)" || echo "ENABLED (CF-Access-JWT-Assertion required)")

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
VITE_ADMIN_PORT="$ADMIN_PORT" VITE_CLIENT_PORT="$CLIENT_PORT" npm run build -w ui --silent

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

# ── start Admin UI (preview) ─────────────────────────────────────────────────
echo "▶ Starting Admin UI on http://localhost:${UI_PORT}..."
(cd ui && VITE_ADMIN_PORT="$ADMIN_PORT" VITE_CLIENT_PORT="$CLIENT_PORT" npx vite preview --port "$UI_PORT" --host 127.0.0.1 > ../logs/ui.log 2>&1) &
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
  echo "║  DEV MODE: Admin API (/api/admin/*) is OPEN (no auth required)     ║"
  echo "║     - /api/v1/* endpoints still require API key authentication   ║"
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
