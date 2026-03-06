# Copilot Proxy

An OpenAI-compatible API gateway that validates API keys, enforces per-key model binding, and forwards requests to Copilot Connect.

## Requirements

- Node.js 18+
- npm 9+

## Quick Start

```bash
# Start all services (installs deps on first run)
./start.sh

# Stop all services
./stop.sh
```

This starts three processes:

| Service              | URL                   | Notes         |
| -------------------- | --------------------- | ------------- |
| Mock Copilot Connect | http://localhost:1289 | Dev/test only |
| Copilot Proxy API    | http://localhost:3000 |               |
| Admin UI             | http://localhost:3001 |               |

## Manual Setup

### 1. Install dependencies

```bash
npm install
cd mockCopilot && npm install && cd ..
```

### 2. Start Mock Copilot Connect

```bash
# Mock runs on port 1289 by default (port 1288 is reserved for real Copilot Connect)
cd mockCopilot && node server.js
```

### 3. Start the proxy server

```bash
# Point to mock Copilot Connect on :1289; swap COPILOT_URL to :1288 for real Copilot Connect
cd server && MOCK_MODE=false COPILOT_URL=http://127.0.0.1:1289 npx tsx src/index.ts
```

### 4. Start the admin UI

```bash
cd ui && npx vite
```

## Creating an API Key

Use the Admin UI at http://localhost:3001, or call the admin API directly:

```bash
curl -s -X POST http://localhost:3000/api/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "my-app", "model": "gpt-4o"}' | jq .
```

The response contains the raw key (shown only once) and the key record. Use the raw key as a Bearer token:

```bash
curl -s http://localhost:3000/v1/models \
  -H "Authorization: Bearer cps_<your-key>"
```

```bash
curl -s -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer cps_<your-key>" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "Hello"}]}' | jq .
```

> **Model override** — The `model` field in the request body is ignored. The proxy always forwards using the model bound to the API key.

## Configuration

Copy and edit the server environment:

```bash
cp server/.env.example server/.env   # if available, or set directly
```

| Variable        | Default                         | Description                                                                     |
| --------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| `PORT`          | `3000`                          | Proxy server port                                                               |
| `COPILOT_URL`   | `http://127.0.0.1:1288`         | Upstream URL. Use `:1289` for the mock server, `:1288` for real Copilot Connect |
| `MOCK_MODE`     | `true`                          | `true` = internal mocks (ignores `COPILOT_URL`). `false` = forward to upstream  |
| `DATABASE_PATH` | `server/data/copilot-server.db` | SQLite database path                                                            |

## Project Structure

```
CopilotProxy/
├── server/          # Proxy server (Express + SQLite)
│   └── src/
│       ├── routes/  # /v1/* proxy, /api/* admin
│       ├── services/
│       ├── middleware/
│       └── db/
├── ui/              # Admin dashboard (React + Vite)
├── mockCopilot/     # Standalone mock Copilot Connect server
├── start.sh
└── stop.sh
```

## Development

Run server and UI in watch mode (uses built-in mocks by default):

```bash
npm run dev
```

Run tests:

```bash
npm run test:api
```
