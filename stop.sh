#!/usr/bin/env bash

PIDS_FILE=".running.pids"
PORTS=(8020 8022 3020)

echo "╔══════════════════════════════════════╗"
echo "║       Copilot Proxy — stop           ║"
echo "╚══════════════════════════════════════╝"
echo ""

# Kill any process listening on the known service ports (reliable fallback)
for port in "${PORTS[@]}"; do
  pids=$(lsof -ti tcp:"$port" 2>/dev/null) || true
  if [ -n "$pids" ]; then
    echo "Stopping processes on port $port (PIDs: $pids)..."
    echo "$pids" | xargs kill 2>/dev/null || true
  fi
done

# Also kill any PIDs recorded in the PID file (belt-and-suspenders)
if [ -f "$PIDS_FILE" ]; then
  while IFS= read -r pid; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "Stopping PID $pid (from $PIDS_FILE)..."
      kill "$pid" 2>/dev/null || true
    fi
  done < "$PIDS_FILE"
  rm -f "$PIDS_FILE"
fi

echo ""
echo "All services stopped."
