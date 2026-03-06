#!/usr/bin/env bash

PIDS_FILE=".running.pids"

echo "╔══════════════════════════════════════╗"
echo "║       Copilot Proxy — stop           ║"
echo "╚══════════════════════════════════════╝"
echo ""

if [ ! -f "$PIDS_FILE" ]; then
  echo "No running services found ($PIDS_FILE not found)."
  exit 0
fi

while IFS= read -r pid; do
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "Stopping PID $pid..."
    kill "$pid" 2>/dev/null || true
  fi
done < "$PIDS_FILE"

rm -f "$PIDS_FILE"
echo ""
echo "All services stopped."
