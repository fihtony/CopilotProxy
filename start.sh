#!/usr/bin/env bash
set -e

PIDS_FILE=".running.pids"

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
npm run build -w ui --silent

echo ""

# ── start Mock Copilot Connect ───────────────────────────────────────────────
echo "▶ Starting Mock Copilot Connect on http://localhost:1289..."
(cd mockCopilot && PORT=1289 node server.js > ../logs/mock-copilot.log 2>&1) &
echo $! >> "$PIDS_FILE"

# give it a moment to bind the port
sleep 1

# ── start Copilot Proxy server ───────────────────────────────────────────────
# COPILOT_URL points to mock Copilot Connect (:1289).
# Change to http://127.0.0.1:1288 to use the real Copilot Connect service.
echo "▶ Starting Copilot Proxy server on http://localhost:3000..."
(cd server && COPILOT_URL=http://127.0.0.1:1289 node dist/index.js > ../logs/server.log 2>&1) &
echo $! >> "$PIDS_FILE"

# ── start Admin UI (preview) ─────────────────────────────────────────────────
echo "▶ Starting Admin UI on http://localhost:3001..."
(cd ui && npx vite preview --port 3001 --host 127.0.0.1 > ../logs/ui.log 2>&1) &
echo $! >> "$PIDS_FILE"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Services are running                                ║"
echo "║                                                      ║"
echo "║   Mock Copilot Connect  →  http://localhost:1289     ║"
echo "║   Copilot Proxy API     →  http://localhost:3000     ║"
echo "║   Admin UI              →  http://localhost:3001     ║"
echo "║                                                      ║"
echo "║  Logs:  ./logs/mock-copilot.log                      ║"
echo "║         ./logs/server.log                            ║"
echo "║         ./logs/ui.log                                ║"
echo "║                                                      ║"
echo "║  Run ./stop.sh to stop all services.                 ║"
echo "╚══════════════════════════════════════════════════════╝"
