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
COPILOT_URL=${COPILOT_URL:-"http://127.0.0.1:1289"}
PROXY_PORT=${PROXY_PORT:-3000}
UI_PORT=${UI_PORT:-3001}
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
AUTH_LABEL=$([[ "$MODE" == "dev" ]] && echo "❌ DISABLED (X-Admin-Key not required)" || echo "✓ ENABLED (CF-Access-JWT-Assertion required)")

echo "╔════════════════════════════════════════════════════════════╗"
echo "║         Copilot Proxy — Starting in $MODE_LABEL           "
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Configuration:"
echo "  Mode:              $MODE_LABEL"
echo "  Cloudflare Auth:   $AUTH_LABEL"
echo ""
echo "API Endpoints:"
if [[ "$MODE" == "dev" ]]; then
  echo "  /v1/*           — Client API (requires API key via Authorization header)"
  echo "  /admin/api/*    — Admin API (no auth, fully open for development)"
else
  echo "  /v1/*           — Client API (requires API key via Authorization header)"
  echo "  /admin/api/*    — Admin API (requires Cloudflare Access JWT token)"
fi
echo ""

# ── install dependencies ─────────────────────────────────────────────────────
echo "▶ Installing root workspace dependencies..."
npm install --silent

echo "▶ Installing Mock Copilot Connect dependencies..."
(cd mockCopilot && npm install --silent)

echo ""

# ── build server & UI ────────────────────────────────────────────────────────
echo "▶ Building server..."
npm run build -w server --silent

echo "▶ Building UI..."
VITE_PROXY_PORT="$PROXY_PORT" npm run build -w ui --silent

echo ""

# ── start Mock Copilot Connect ───────────────────────────────────────────────
echo "▶ Starting Mock Copilot Connect on http://localhost:1289..."
(cd mockCopilot && PORT=1289 node server.js > ../logs/mock-copilot.log 2>&1) &
echo $! >> "$PIDS_FILE"

# give it a moment to bind the port
sleep 1

# ── start Copilot Proxy server ───────────────────────────────────────────────
# Uses COPILOT_URL, PROXY_PORT, DATABASE_PATH, and NODE_ENV
echo "▶ Starting Copilot Proxy server on http://localhost:${PROXY_PORT}..."
(cd server && NODE_ENV="$NODE_ENV" COPILOT_URL="$COPILOT_URL" PROXY_PORT="$PROXY_PORT" DATABASE_PATH="$DATABASE_PATH" node dist/index.js > ../logs/server.log 2>&1) &
echo $! >> "$PIDS_FILE"

# ── start Admin UI (preview) ─────────────────────────────────────────────────
echo "▶ Starting Admin UI on http://localhost:${UI_PORT}..."
(cd ui && VITE_PROXY_PORT="$PROXY_PORT" npx vite preview --port "$UI_PORT" --host 127.0.0.1 > ../logs/ui.log 2>&1) &
echo $! >> "$PIDS_FILE"

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║  All services are running ($MODE mode)                       ║"
echo "║                                                               ║"
echo "║   Mock Copilot Connect  →  http://localhost:1289              ║"
echo "║   Copilot Proxy API     →  http://localhost:${PROXY_PORT}     ║"
echo "║   Admin UI              →  http://localhost:${UI_PORT}     ║"
echo "║                                                               ║"
if [[ "$MODE" == "dev" ]]; then
  echo "║  🔓 DEV MODE: Admin API (/admin/api/*) is OPEN                 ║"
  echo "║     - No authentication required                             ║"
  echo "║     - X-Admin-Key header is optional                         ║"
  echo "║     - /v1/* endpoints still require API key authentication   ║"
else
  echo "║  🔒 PROD MODE: Admin API (/admin/api/*) requires auth        ║"
  echo "║     - Cloudflare Access JWT token required                  ║"
  echo "║     - /v1/* endpoints require API key authentication         ║"
fi
echo "║                                                               ║"
echo "║  Logs:  ./logs/mock-copilot.log                               ║"
echo "║         ./logs/server.log          (NODE_ENV=$NODE_ENV)       ║"
echo "║         ./logs/ui.log                                         ║"
echo "║                                                               ║"
echo "║  Run ./stop.sh to stop all services.                          ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
