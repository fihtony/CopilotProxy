#!/usr/bin/env bash
# test-real-copilot.sh
#
# PURPOSE: Test a real Copilot Connect endpoint (localhost:1288 by default)
#          and capture responses to ./real-copilot-responses/ for reference.
#          Run BEFORE updating mockCopilot so the mock can mirror real response shapes.
#
# USAGE:
#   ./scripts/test-real-copilot.sh [BASE_URL] [API_KEY]
#
#   BASE_URL  — defaults to http://127.0.0.1:1288
#   API_KEY   — Bearer token to send; omit if not required by the real service
#               (Copilot Connect may use its own internal auth)
#
# OUTPUT: JSON files in ./scripts/real-responses/

set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:1288}"
API_KEY="${2:-}"
MODEL="gpt-5-mini"
OUT_DIR="$(dirname "$0")/real-responses"
mkdir -p "$OUT_DIR"

AUTH_HEADER=""
if [[ -n "$API_KEY" ]]; then
  AUTH_HEADER="-H \"Authorization: Bearer $API_KEY\""
fi

echo "=== Copilot Connect Real Response Capture ==="
echo "Base URL : $BASE_URL"
echo "Model    : $MODEL"
echo "Output   : $OUT_DIR"
echo ""

# ── Helper ────────────────────────────────────────────────────────────────────
call() {
  local name="$1"
  local method="$2"
  local path="$3"
  local data="${4:-}"
  local file="$OUT_DIR/${name}.json"

  echo -n "[$name] "
  local args=(-s -o "$file" -w "%{http_code}" -X "$method" "$BASE_URL$path" \
    -H "Content-Type: application/json")
  [[ -n "$API_KEY" ]] && args+=(-H "Authorization: Bearer $API_KEY")
  [[ -n "$data" ]]    && args+=(-d "$data")

  local status
  status=$(curl "${args[@]}")
  echo "HTTP $status → $file"
}

# ── 1. List models ─────────────────────────────────────────────────────────────
call "01_models" GET /v1/models

# ── 2. Simple chat completion ──────────────────────────────────────────────────
call "02_chat_basic" POST /v1/chat/completions "$(cat <<EOF
{
  "model": "$MODEL",
  "messages": [{"role": "user", "content": "Say hello in one sentence."}],
  "temperature": 0.7,
  "max_tokens": 50
}
EOF
)"

# ── 3. Chat with system message ────────────────────────────────────────────────
call "03_chat_system" POST /v1/chat/completions "$(cat <<EOF
{
  "model": "$MODEL",
  "messages": [
    {"role": "system", "content": "You are a concise assistant."},
    {"role": "user", "content": "What is 2+2?"}
  ],
  "temperature": 0
}
EOF
)"

# ── 4. Multi-turn conversation ─────────────────────────────────────────────────
call "04_chat_multiturn" POST /v1/chat/completions "$(cat <<EOF
{
  "model": "$MODEL",
  "messages": [
    {"role": "user", "content": "My name is Alice."},
    {"role": "assistant", "content": "Hello Alice, how can I help you?"},
    {"role": "user", "content": "What is my name?"}
  ]
}
EOF
)"

# ── 5. Large token usage ───────────────────────────────────────────────────────
call "05_chat_tokens" POST /v1/chat/completions "$(cat <<EOF
{
  "model": "$MODEL",
  "messages": [{"role": "user", "content": "List 10 programming languages and their main use cases."}],
  "max_tokens": 500
}
EOF
)"

# ── 6. JSON mode (if supported) ────────────────────────────────────────────────
call "06_chat_json_mode" POST /v1/chat/completions "$(cat <<EOF
{
  "model": "$MODEL",
  "messages": [{"role": "user", "content": "Return a JSON object with keys: name, age, city."}],
  "response_format": {"type": "json_object"}
}
EOF
)"

# ── 7. Low temperature (deterministic) ────────────────────────────────────────
call "07_chat_temp0" POST /v1/chat/completions "$(cat <<EOF
{
  "model": "$MODEL",
  "messages": [{"role": "user", "content": "What is the capital of France?"}],
  "temperature": 0
}
EOF
)"

# ── 8. Stop sequence ──────────────────────────────────────────────────────────
call "08_chat_stop" POST /v1/chat/completions "$(cat <<EOF
{
  "model": "$MODEL",
  "messages": [{"role": "user", "content": "Count from 1 to 10."}],
  "stop": ["5"]
}
EOF
)"

# ── 9. Legacy text completion ──────────────────────────────────────────────────
call "09_completions_legacy" POST /v1/completions "$(cat <<EOF
{
  "model": "$MODEL",
  "prompt": "The quick brown fox",
  "max_tokens": 30
}
EOF
)"

# ── 10. Error: bad model ───────────────────────────────────────────────────────
call "10_error_bad_model" POST /v1/chat/completions "$(cat <<EOF
{
  "model": "non-existent-model-xyz",
  "messages": [{"role": "user", "content": "test"}]
}
EOF
)"

# ── 11. Error: missing messages ────────────────────────────────────────────────
call "11_error_no_messages" POST /v1/chat/completions "$(cat <<EOF
{
  "model": "$MODEL"
}
EOF
)"

echo ""
echo "=== Done. Review JSON files in $OUT_DIR ==="
echo "Use these files to align mockCopilot response format."
