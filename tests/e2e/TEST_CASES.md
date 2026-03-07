# Copilot Proxy — E2E Test Cases

> **Stack**: Playwright against `http://127.0.0.1:3001` (UI) and `http://127.0.0.1:3000` (API proxy).  
> **Upstream**: Mock Copilot Connect on `:1289` (started by `start.sh`).  
> All test files live in `tests/e2e/`.

---

## TC-KEY: API Key Management

### TC-KEY-01 Create API Key (happy path)

**File**: `keys.spec.ts`  
**Steps**:

1. Navigate to `/keys`
2. Click "Create New Key" → modal opens
3. Fill name, select model from dropdown
4. Click "Create"
   **Expected**:

- Displayed generated key starts with `cps_` and is 36 chars (`cps_` + 32 hex)
- Close modal → new row appears in the key table
- `GET /api/keys` returns the new item with correct model, `is_active: 1`, `is_deleted: 0`
- `key_preview` in DB = first 8 chars + `...` + last 4 chars of the raw key

### TC-KEY-02 Default model from settings

**File**: `keys.spec.ts`  
**Steps**:

1. Create a key without specifying model
   **Expected**:

- API returns `model` matching the `default_model` from `GET /api/settings`

### TC-KEY-03 Update key name and model via edit modal

**File**: `keys.spec.ts`  
**Steps**:

1. Click "Edit" on a key row → edit modal opens
2. Change name and model
3. Click "Save"
   **Expected**:

- Row reflects updated name and model after modal closes
- `updated_at` in DB is later than `created_at`

### TC-KEY-04 (Removed — disable/enable replaced by soft delete)

### TC-KEY-05 Soft delete a key

**File**: `keys.spec.ts`  
**Steps**:

1. Click "Delete" on a key row → confirmation modal opens
2. Click "Delete" in confirmation modal
   **Expected**:

- Row remains visible with deleted styling (no Edit/Delete buttons)
- `DELETE /api/keys/:id` returns `200 { ok: true }` (soft delete)
- `is_deleted = 1`, `is_active = 0`
- Proxy rejects requests with deleted key (401)
- Historical stats remain accessible

### TC-KEY-06 Generated raw key shown only once

**File**: `keys.spec.ts`  
**Steps**:

1. Create a key in modal; capture the shown raw key
2. Close modal / navigate away
   **Expected**: Full raw key no longer shown; only `key_preview` (masked) visible

---

## TC-AUTH: Authentication & Authorization

### TC-AUTH-01 Request without API key → 401

**File**: `auth.spec.ts`  
**Steps**:

1. `POST /v1/chat/completions` with no `Authorization` header
   **Expected**: HTTP 401, `error.message` contains "Missing Bearer"

### TC-AUTH-02 Request with invalid API key → 401

**File**: `auth.spec.ts`  
**Steps**:

1. `POST /v1/chat/completions` with `Authorization: Bearer cps_invalid`
   **Expected**: HTTP 401, `error.message` contains "Invalid or inactive"

### TC-AUTH-03 Request with disabled key → 401

**File**: `auth.spec.ts`  
**Steps**:

1. Create a key, disable it via `PATCH /api/keys/:id` (`is_active: 0`)
2. Send a request with the disabled key
   **Expected**: HTTP 401

### TC-AUTH-04 Request with valid key → 200

**File**: `auth.spec.ts`  
**Steps**:

1. Create a key, use it in a `POST /v1/chat/completions` request
   **Expected**: HTTP 200, response body has `object: "chat.completion"`

### TC-AUTH-05 Model override — key model wins

**File**: `auth.spec.ts`  
**Steps**:

1. Create a key with `model: "gpt-5-mini"`
2. Send request with `model: "override-attempt"`
   **Expected**: Response body `model` = `"gpt-5-mini"` (key model, not the request model)

### TC-AUTH-06 GET /v1/models requires valid key

**File**: `auth.spec.ts`  
**Steps**:

1. `GET /v1/models` without auth header
2. `GET /v1/models` with valid bearer key
   **Expected**: Step 1 → 401; Step 2 → 200 with model list

---

## TC-STATS: Usage Statistics & Tracking

### TC-STATS-01 Successful request increments total calls

**File**: `stats.spec.ts`  
**Steps**:

1. Create a key, note initial `totalCalls = 0`
2. Send 3 requests
3. `GET /api/keys/:id/stats`
   **Expected**: `stats.totalCalls = 3`, `stats.successRate = 100`

### TC-STATS-02 Failed request (upstream 502) counted with success=0

**File**: `stats.spec.ts`  
**Steps**:

1. Temporarily point proxy to a non-existent host, send a request
2. Check stats
   **Expected**: `stats.successRate < 100`, error row in history

### TC-STATS-03 Response time is recorded

**File**: `stats.spec.ts`  
**Steps**:

1. Send a request
2. `GET /api/keys/:id/stats`
   **Expected**: `stats.avgResponseTime > 0` (positive milliseconds)

### TC-STATS-04 Token counts stored

**File**: `stats.spec.ts`  
**Steps**:

1. Send a chat completion request with a known prompt
2. Check `GET /api/keys/:id/history`
   **Expected**:

- `prompt_tokens > 0`, `completion_tokens > 0`, `total_tokens = prompt + completion`
- `model_used` = key model (not request model)
- `model_requested` = the model field sent in the request body

### TC-STATS-05 Overview aggregates across all keys

**File**: `stats.spec.ts`  
**Steps**:

1. Create two keys, each makes N requests
2. `GET /api/overview`
   **Expected**: `summary.totalCalls = totalRequests`, `summary.activeKeys >= 2`

### TC-STATS-06 Time window filtering (24h, 7d, 30d, 90d)

**File**: `stats.spec.ts`  
**Steps**:

1. Make requests
2. Query `GET /api/overview?window=24h` vs `?window=30d`
   **Expected**: `24h` window totals ≤ `30d` window totals

### TC-STATS-07 UI metric cards display correct labels (5 cards)

**File**: `stats.spec.ts` / `dashboard.spec.ts`  
**Steps**:

1. Seed requests
2. Navigate to `/` (Dashboard page)
3. Check "Total Requests", "Success Rate", "Avg Proxy Latency", "Avg Response Time", "Avg Tokens"
   **Expected**: All 5 cards visible with P90/P95/P99 hints on latency and token cards

### TC-STATS-08 Timeline chart renders after making requests

**File**: `dashboard.spec.ts`  
**Steps**:

1. Navigate to `/keys/:id`
2. Verify `[data-testid="timeline-chart"]` is visible after seeding traffic
   **Expected**: Chart element present and has non-zero dimensions

---

## TC-HIST: Request History

### TC-HIST-01 History table shows request rows

**File**: `history.spec.ts`  
**Steps**:

1. Make N requests with a key
2. Navigate to `/keys/:id`
3. Check history table
   **Expected**: At least N rows with `[data-testid="history-row"]`

### TC-HIST-02 Model column shows forced model

**File**: `history.spec.ts`  
**Steps**:

1. Create key with model `gpt-5-mini`, send request with `model: "not-used"`
2. Check history row
   **Expected**: "Used" column = `gpt-5-mini`, "Requested" column = `not-used`

### TC-HIST-03 Pagination — page 2 loads different rows

**File**: `history.spec.ts`  
**Steps**:

1. Generate > 20 requests
2. Navigate to next page
   **Expected**: Different set of rows; total count correct

---

## TC-TIME: Timestamp Display

### TC-TIME-01 Timestamps in DB use ISO 8601 with UTC offset

**File**: `timestamp.spec.ts`  
**Steps**:

1. Create an API key via `POST /api/keys`
2. Read `created_at` from `GET /api/keys`
   **Expected**: `created_at` matches `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/` (ISO 8601 with Z)

### TC-TIME-02 Request timestamps in DB are ISO 8601

**File**: `timestamp.spec.ts`  
**Steps**:

1. Make a request
2. Read `timestamp` from `GET /api/keys/:id/history`
   **Expected**: `timestamp` is a valid ISO 8601 string

### TC-TIME-03 UI displays timestamps in local browser time

**File**: `timestamp.spec.ts`  
**Steps**:

1. Create a key, make a request, navigate to key detail page
2. Observe timestamps in "Recent Requests" table
   **Expected**: Time cell contains a locale-formatted date string (not raw UTC), parseable by `new Date()`

### TC-TIME-04 updated_at advances on key update

**File**: `timestamp.spec.ts`  
**Steps**:

1. Create a key, record `created_at`
2. Immediately `PATCH /api/keys/:id` to change the name
3. Record `updated_at`
   **Expected**: `updated_at >= created_at` (strictly later or equal, never earlier)

---

## TC-UI: UI Smoke & Navigation

### TC-UI-01 Dashboard page renders with 5 metric cards and health indicator

**File**: `dashboard.spec.ts`  
**Steps**: Navigate to `/`
**Expected**: "Dashboard" heading, 5 metric cards, health indicator, timecharts visible

### TC-UI-03 Key detail page navigable

**File**: `dashboard.spec.ts`  
**Expected**: "Key Dashboard" heading, timeline chart visible

### TC-UI-04 Back navigation from key detail

**File**: `dashboard.spec.ts`  
**Expected**: Back link returns to `/keys`

---

## TC-SET: Settings

### TC-SET-01 Settings page displays current config

**File**: `settings.spec.ts`  
**Steps**: Navigate to `/settings`
**Expected**: Copilot URL input visible with current value

### TC-SET-02 Test connection shows model list

**File**: `settings.spec.ts`  
**Steps**: Click "Test Connection"
**Expected**: Model list with available models

### TC-SET-03 Update settings via API

**File**: `settings.spec.ts`  
**Expected**: `PUT /api/settings` returns updated values

### TC-SET-04 Invalid URL rejected

**File**: `settings.spec.ts`  
**Expected**: `PUT /api/settings` with invalid URL returns 400

---

## Running the Tests

```bash
# Start all services (mock on :1289, proxy on :3000, UI on :3001)
./start.sh

# Run all E2E tests
npm run test:e2e

# Run a specific spec
npx playwright test tests/e2e/auth.spec.ts

# Run in headed mode for debugging
npx playwright test tests/e2e/keys.spec.ts --headed

# Open HTML report after run
npx playwright show-report
```
