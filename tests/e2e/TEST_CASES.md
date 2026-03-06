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
2. Fill in name = `"Test Key <timestamp>"`, model = `"gpt-5-mini"`
3. Click "Create API Key"
**Expected**:
- Displayed generated key starts with `cps_` and is 36 chars (`cps_` + 32 hex)
- New row appears in the key list matching the name
- `GET /api/keys` returns the new item with `model: "gpt-5-mini"`, `is_active: 1`
- `key_preview` in DB = first 8 chars + `...` + last 4 chars of the raw key

### TC-KEY-02 Default model is gpt-5-mini
**File**: `keys.spec.ts`  
**Steps**:
1. Create a key leaving the model field blank (or with the default placeholder)
**Expected**:
- API returns `model: "gpt-5-mini"` (default fallback)

### TC-KEY-03 Update key name and model
**File**: `keys.spec.ts`  
**Steps**:
1. Create a key, note its row
2. Edit name → `"Renamed Key"`, model → `"gpt-4o-mini"`
3. Click "Save"
**Expected**:
- Row reflects updated name and model
- `GET /api/keys/:id` returns `name: "Renamed Key"`, `model: "gpt-4o-mini"`
- `updated_at` in DB is later than `created_at`

### TC-KEY-04 Disable and re-enable a key
**File**: `keys.spec.ts`  
**Steps**:
1. Click "Disable" on an active key
2. Verify button becomes "Enable"
3. Click "Enable"
**Expected**:
- After disable: `is_active = 0` in DB; proxy rejects requests with 401
- After enable: `is_active = 1`; proxy accepts requests again

### TC-KEY-05 Delete a key
**File**: `keys.spec.ts`  
**Steps**:
1. Click "Delete" on a key
**Expected**:
- Row disappears from UI
- `GET /api/keys/:id` returns 404
- Historical request rows for that key are purged (or the key appears removed)

### TC-KEY-06 Create key with missing name — validation error
**File**: `keys.spec.ts`  
**Steps**:
1. Submit Create form with empty name
**Expected**:
- Error message visible; no new key in the list
- `POST /api/keys` returns HTTP 400

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

### TC-STATS-06 Time window filtering (1h, 24h, 7d, 30d)
**File**: `stats.spec.ts`  
**Steps**:
1. Make requests
2. Query `GET /api/overview?window=1h` vs `?window=30d`
**Expected**: `1h` window totals ≤ `30d` window totals; UI time-window buttons change the displayed numbers

### TC-STATS-07 UI metric cards display correct numbers
**File**: `dashboard.spec.ts`  
**Steps**:
1. Seed requests
2. Navigate to `/` (Overview page)
3. Check "Total Calls", "Success Rate", "Avg Response Time", "Active Keys"
**Expected**: Values match the API response from `GET /api/overview`

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

### TC-UI-01 Overview page renders without errors
**File**: `dashboard.spec.ts`  
**Steps**: Navigate to `/`
**Expected**: "Copilot Proxy command deck" heading visible, no console errors

### TC-UI-02 Keys management page renders
**File**: `keys.spec.ts`  
**Steps**: Navigate to `/keys`
**Expected**: "Create a new key" panel visible

### TC-UI-03 Key detail page navigable from key list
**File**: `dashboard.spec.ts`  
**Steps**: Click key name in overview table → detail page
**Expected**: "Key Dashboard" heading visible for the correct key

### TC-UI-04 Back navigation from key detail
**File**: `dashboard.spec.ts`  
**Steps**: On key detail page, click "Back to key management"
**Expected**: Returns to `/keys`

### TC-UI-05 Generated key shown only once after creation
**File**: `keys.spec.ts`  
**Steps**:
1. Create a key; capture the shown raw key
2. Navigate away, return to /keys
**Expected**: Full raw key no longer shown; only `key_preview` (masked) visible

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
npx playwright test --headed

# Open HTML report after run
npx playwright show-report
```
