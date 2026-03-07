#!/bin/bash

# Test Proxy Script
# Sends HTTP requests to the Copilot Proxy to test connectivity
#
# Usage:
#   ./scripts/test-proxy.sh <api-key> <chat-message> [model-name]
#
# Parameters:
#   api-key        (required) Your API key (format: cps_xxxxxxxx...)
#   chat-message   (required) The chat message to send (e.g., "What is the weather?")
#   model-name     (optional) Model to use (default: gpt-5-mini)
#
# Examples:
#   ./scripts/test-proxy.sh cps_abc123 "Hello world"
#   ./scripts/test-proxy.sh cps_abc123 "Say hello" gpt-4-turbo

set -euo pipefail

PROXY_URL="${PROXY_URL:-http://127.0.0.1:3000}"
MODEL="${3:-gpt-5-mini}"
API_KEY="${1:-}"
CHAT_MESSAGE="${2:-}"

# Validate inputs
if [ -z "$API_KEY" ]; then
  echo "Error: API key is required"
  echo ""
  echo "Usage: $0 <api-key> <chat-message> [model-name]"
  echo ""
  echo "Examples:"
  echo "  $0 cps_abc123 'What is the weather?'"
  echo "  $0 cps_abc123 'Say hello' gpt-4-turbo"
  exit 1
fi

if [ -z "$CHAT_MESSAGE" ]; then
  echo "Error: Chat message is required"
  echo ""
  echo "Usage: $0 <api-key> <chat-message> [model-name]"
  exit 1
fi

echo "🔗 Copilot Proxy Test Script"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┏"
echo "Proxy URL:   $PROXY_URL"
echo "API Key:     ${API_KEY:0:16}..."
echo "Model:       $MODEL"
echo "Message:     $CHAT_MESSAGE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test 1: Get available models
echo "📋 [Test 1/2] Fetching available models..."
echo ""

MODELS_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$PROXY_URL/v1/models" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json")

# Parse response and status code using awk
HTTP_STATUS=$(echo "$MODELS_RESPONSE" | awk 'END {print $NF}')
MODELS_BODY=$(echo "$MODELS_RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_STATUS"
echo ""
echo "Response:"
echo "$MODELS_BODY" | jq . 2>/dev/null || echo "$MODELS_BODY"
echo ""

# Test 2: Send a chat completion request
echo "💬 [Test 2/2] Sending chat completion request..."
echo ""

REQUEST_BODY=$(cat <<EOF
{
  "model": "$MODEL",
  "messages": [
    {
      "role": "user",
      "content": "$CHAT_MESSAGE"
    }
  ],
  "max_tokens": 256
}
EOF
)

echo "Request:"
echo "$REQUEST_BODY" | jq . 2>/dev/null || echo "$REQUEST_BODY"
echo ""

CHAT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$PROXY_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "$REQUEST_BODY")

# Parse response and status code using awk
HTTP_STATUS=$(echo "$CHAT_RESPONSE" | awk 'END {print $NF}')
CHAT_BODY=$(echo "$CHAT_RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_STATUS"
echo ""
echo "Response:"
echo "$CHAT_BODY" | jq . 2>/dev/null || echo "$CHAT_BODY"
echo ""

echo "✅ Tests completed!"
