# Copilot Proxy

An OpenAI-compatible API gateway that validates API keys, enforces per-key model binding, and forwards requests to Copilot Connect.

## Features

- **Per-key model binding** — each API key is locked to a specific model; the `model` field in incoming requests is always ignored
- **Dashboard** — real-time metrics with 5 cards (total calls, success rate, proxy latency, response time, avg tokens), P90/P95/P99 percentiles, and interactive timecharts
- **Health indicator** — polls upstream Copilot Connect every 30 seconds
- **API key management** — create, edit, and soft-delete keys via modal-based UI; search, sort, and filter; see `last_used_at` timestamp for each key
- **Key-level dashboard** — per-key statistics, timeline charts, recent error logs, and **calls breakdown by client IP address and Host header**
- **Settings** — configure upstream Copilot URL and default model; test connection to discover available models
- **Soft delete** — deleted keys retain historical data and statistics; proxy rejects them with 401
- **Request tracking** — each API request logs the client IP address and Host header for analysis and debugging

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

| Variable        | Default                   | Description                                                                                 |
| --------------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| `PORT`          | `3000`                    | Proxy server port                                                                           |
| `COPILOT_URL`   | `http://127.0.0.1:1288`   | Upstream URL (initial value; can be changed in Settings UI). `:1289` = mock, `:1288` = real |
| `DATABASE_PATH` | `./data/copilot-proxy.db` | SQLite database path                                                                        |

> `COPILOT_URL` seeds the `settings` table on first run. After that, the URL is managed via the Settings page or `PUT /api/settings`.

## Project Structure

```
CopilotProxy/
├── server/          # Proxy server (Express + SQLite)
│   └── src/
│       ├── routes/  # /v1/* proxy, /api/* admin
│       ├── services/   # proxyService, statsService, settingsService
│       ├── middleware/
│       └── db/
├── ui/              # Admin dashboard (React + Vite)
│   └── src/
│       ├── pages/   # Dashboard, KeysManage, KeyDetail, Settings
│       └── components/  # MetricCard, TimelineChart, HealthIndicator, Modal
├── mockCopilot/     # Standalone mock Copilot Connect server
├── tests/
│   ├── api/         # Jest + supertest integration tests
│   └── e2e/         # Playwright end-to-end tests
├── start.sh
└── stop.sh
```

## Admin API

| Method   | Endpoint                             | Description                                            |
| -------- | ------------------------------------ | ------------------------------------------------------ |
| `GET`    | `/api/keys?search=&sortBy=&sortDir=` | List keys with stats                                   |
| `POST`   | `/api/keys`                          | Create key (model optional; defaults from settings)    |
| `PATCH`  | `/api/keys/:id`                      | Update key name/model/is_active                        |
| `DELETE` | `/api/keys/:id`                      | Soft-delete key (returns `200 { ok: true }`)           |
| `GET`    | `/api/keys/:id/stats?window=`        | Key statistics, P-values, timeline, errors             |
| `GET`    | `/api/keys/:id/history?page=&limit=` | Paginated request history                              |
| `GET`    | `/api/overview?window=`              | Global metrics, P-values, timeline, key summaries      |
| `GET`    | `/api/settings`                      | Read settings (copilot_url, default_model)             |
| `PUT`    | `/api/settings`                      | Update settings                                        |
| `GET`    | `/api/health/copilot`                | Test upstream connection (returns ok, latency, models) |

Time windows: `24h`, `7d`, `30d`, `90d`

## Development

Run server and UI in watch mode (uses built-in mocks by default):

```bash
npm run dev
```

Run tests:

```bash
# API integration tests (Jest + supertest)
npm run test:api

# E2E tests (Playwright — auto-starts dev server)
npm run test:e2e
```
