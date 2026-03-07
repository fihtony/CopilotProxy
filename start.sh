#!/usr/bin/env bash
set -e

PIDS_FILE=".running.pids"

# ── load environment variables ─────────────────────────────────────────────
set -a
source .env
set +a

# Set defaults if not defined
COPILOT_URL=${COPILOT_URL:-"http://127.0.0.1:1289"}
PROXY_PORT=${PROXY_PORT:-3000}
UI_PORT=${UI_PORT:-3001}
DATABASE_PATH=${DATABASE_PATH:-"./data"}

# Convert DATABASE_PATH to absolute path from project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
if [[ "$DATABASE_PATH" != /* ]]; then
  DATABASE_PATH="$SCRIPT_DIR/$DATABASE_PATH"
fi

# ── clean up from any previous run ──────────────────────────────────────────
> "$PIDS_FILE"
mkdir -p logs

echo "╔══════════════════════════════════════╗"
echo "║       Copilot Proxy — start          ║"
echo "╚══════════════════════════════════════╝"
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
# Uses COPILOT_URL, PROXY_PORT, and DATABASE_PATH from .env
echo "▶ Starting Copilot Proxy server on http://localhost:${PROXY_PORT}..."
(cd server && COPILOT_URL="$COPILOT_URL" PROXY_PORT="$PROXY_PORT" DATABASE_PATH="$DATABASE_PATH" node dist/index.js > ../logs/server.log 2>&1) &
echo $! >> "$PIDS_FILE"

# ── start Admin UI (preview) ─────────────────────────────────────────────────
echo "▶ Starting Admin UI on http://localhost:${UI_PORT}..."
(cd ui && VITE_PROXY_PORT="$PROXY_PORT" npx vite preview --port "$UI_PORT" --host 127.0.0.1 > ../logs/ui.log 2>&1) &
echo $! >> "$PIDS_FILE"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Services are running                                ║"
echo "║                                                      ║"
echo "║   Mock Copilot Connect  →  http://localhost:1289     ║"
echo "║   Copilot Proxy API     →  http://localhost:${PROXY_PORT}     ║"
echo "║   Admin UI              →  http://localhost:${UI_PORT}     ║"
echo "║                                                      ║"
echo "║  Logs:  ./logs/mock-copilot.log                      ║"
echo "║         ./logs/server.log                            ║"
echo "║         ./logs/ui.log                                ║"
echo "║                                                      ║"
echo "║  Run ./stop.sh to stop all services.                 ║"
echo "╚══════════════════════════════════════════════════════╝"
