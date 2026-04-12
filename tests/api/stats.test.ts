/**
 * Statistics Routes Tests
 *
 * Tests the /api/keys/:id/stats and /api/overview endpoints on the admin app.
 * These are protected by cloudflareAuthMiddleware (LOCAL_ADMIN_USER in dev).
 *
 * Upstream Copilot Connect server URL:
 *   - process.env.COPILOT_URL (set in setupEnv.cjs, defaults to http://127.0.0.1:1288)
 *
 * Tests run against CopilotConnect in echo mode (no real Copilot requests consumed).
 * Ensure CopilotConnect is running before executing tests.
 */

import request from "supertest";
import { createApp } from "../../server/src/app.js";
import { db } from "../../server/src/db/database.js";

function insertSyntheticRequest(input: {
  apiKeyId: number;
  timestamp: string;
  success: number;
  responseTimeMs: number;
  proxyTimeMs: number;
  statusCode?: number;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  errorMessage?: string | null;
  modelUsed?: string;
}) {
  db.prepare(
    `
      INSERT INTO requests (
        api_key_id, timestamp, method, path, status_code, success, response_time_ms, proxy_time_ms,
        prompt_tokens, completion_tokens, total_tokens,
        model_requested, model_used, error_message, ip_address, host
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    input.apiKeyId,
    input.timestamp,
    "POST",
    "/api/v1/chat/completions",
    input.statusCode ?? (input.success === 1 ? 200 : 500),
    input.success,
    input.responseTimeMs,
    input.proxyTimeMs,
    input.promptTokens ?? 0,
    input.completionTokens ?? 0,
    input.totalTokens ?? 0,
    "ignored",
    input.modelUsed ?? "gpt-5-mini",
    input.errorMessage ?? null,
    "127.0.0.1",
    "localhost",
  );
}

function getZonedBucketParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: String(values.year),
    month: String(values.month),
    day: String(values.day),
    hour: String(values.hour),
  };
}

function toFourHourBucket(timestamp: string, timeZone: string) {
  const parts = getZonedBucketParts(new Date(timestamp), timeZone);
  const flooredHour = Math.floor(Number(parts.hour) / 4) * 4;
  return `${parts.year}-${parts.month}-${parts.day} ${String(flooredHour).padStart(2, "0")}:00:00`;
}

function getExpected7dBucketCount(date: Date, timeZone: string) {
  const parts = getZonedBucketParts(date, timeZone);
  return 36 + Math.floor(Number(parts.hour) / 4) + 1;
}

describe("stats routes", () => {
  const app = createApp();
  let rawKey = "";
  let keyId = 0;

  beforeAll(async () => {
    const createResponse = await request(app).post("/api/admin/keys").send({ name: "Stats Key", allowed_models: ["gpt-5-mini"], fallback_model: "gpt-5-mini" }).expect(201);
    rawKey = createResponse.body.rawKey;
    keyId = createResponse.body.item.id;

    // Fire several requests to produce stats
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/api/v1/chat/completions")
        .set("Authorization", `Bearer ${rawKey}`)
        .send({ model: "ignored", messages: [{ role: "user", content: `msg-${i}` }] })
        .expect(200);
    }
  }, 30000); // Increase timeout for this hook

  // ── Overview ──────────────────────────────────────────────────────────
  it("returns overview with summary, p-values and timeline", async () => {
    const overview = await request(app).get("/api/admin/overview?window=24h").expect(200);

    // Summary fields
    const s = overview.body.summary;
    expect(s.totalCalls).toBeGreaterThan(0);
    expect(s.successRate).toBeGreaterThan(0);
    expect(s.avgProxyTime).toBeGreaterThanOrEqual(0);
    expect(s.avgResponseTime).toBeGreaterThanOrEqual(0);
    expect(typeof s.avgTokensPerRequest).toBe("number");

    // Percentile fields
    expect(typeof s.p90ProxyTime).toBe("number");
    expect(typeof s.p95ResponseTime).toBe("number");
    expect(typeof s.p99Tokens).toBe("number");

    // Timeline
    expect(Array.isArray(overview.body.timeline)).toBe(true);
    expect(Array.isArray(overview.body.request_timeline_total)).toBe(true);

    // Key summaries
    expect(Array.isArray(overview.body.keySummaries)).toBe(true);
  });

  it("supports 90d window", async () => {
    const res = await request(app).get("/api/admin/overview?window=90d").expect(200);
    expect(res.body.summary.totalCalls).toBeGreaterThan(0);
  });

  it("keeps 24h overview totals aligned with the chart buckets", async () => {
    const res = await request(app).get("/api/admin/overview?window=24h&timezone=UTC").expect(200);
    const timelineCalls = res.body.timeline.reduce((sum: number, point: { calls: number }) => sum + point.calls, 0);

    expect(res.body.timeline).toHaveLength(24);
    expect(timelineCalls).toBe(res.body.summary.totalCalls);
  });

  // ── Key stats ─────────────────────────────────────────────────────────
  it("returns key stats with p-values and errors list", async () => {
    const res = await request(app).get(`/api/admin/keys/${keyId}/stats?window=24h`).expect(200);

    expect(res.body.stats.totalCalls).toBeGreaterThan(0);
    expect(typeof res.body.stats.avgProxyTime).toBe("number");
    expect(typeof res.body.stats.avgTokensPerRequest).toBe("number");
    expect(typeof res.body.stats.p90ProxyTime).toBe("number");

    expect(Array.isArray(res.body.timeline)).toBe(true);
    expect(Array.isArray(res.body.recentErrors)).toBe(true);
    expect(res.body.item).toBeDefined();
  });

  it("calculates average latencies from successful requests only", async () => {
    const created = await request(app).post("/api/admin/keys").send({ name: "Success Only Stats", allowed_models: ["gpt-5-mini"], fallback_model: "gpt-5-mini" }).expect(201);
    const timestamp = new Date().toISOString();

    insertSyntheticRequest({
      apiKeyId: created.body.item.id,
      timestamp,
      success: 1,
      responseTimeMs: 120,
      proxyTimeMs: 40,
      totalTokens: 12,
    });
    insertSyntheticRequest({
      apiKeyId: created.body.item.id,
      timestamp,
      success: 0,
      responseTimeMs: 9000,
      proxyTimeMs: 5000,
      totalTokens: 0,
      errorMessage: "synthetic failure",
    });

    const res = await request(app).get(`/api/admin/keys/${created.body.item.id}/stats?window=24h&timezone=UTC`).expect(200);
    const timelineCalls = res.body.timeline.reduce((sum: number, point: { calls: number }) => sum + point.calls, 0);

    expect(res.body.timeline).toHaveLength(24);
    expect(res.body.stats.totalCalls).toBe(2);
    expect(res.body.stats.successRate).toBe(50);
    expect(res.body.stats.avgProxyTime).toBe(40);
    expect(res.body.stats.avgResponseTime).toBe(120);
    expect(timelineCalls).toBe(2);
  });

  it("builds 7d buckets in the requested timezone", async () => {
    const created = await request(app).post("/api/admin/keys").send({ name: "Timezone Stats", allowed_models: ["gpt-5-mini"], fallback_model: "gpt-5-mini" }).expect(201);
    const timeZone = "America/Halifax";
    const timestamp = new Date().toISOString();
    const expectedBucket = toFourHourBucket(timestamp, timeZone);
    const statsRequestedAt = new Date();
    const expectedLastBucket = toFourHourBucket(statsRequestedAt.toISOString(), timeZone);
    const expectedBucketCount = getExpected7dBucketCount(statsRequestedAt, timeZone);

    insertSyntheticRequest({
      apiKeyId: created.body.item.id,
      timestamp,
      success: 1,
      responseTimeMs: 250,
      proxyTimeMs: 90,
      totalTokens: 20,
    });

    const res = await request(app)
      .get(`/api/admin/keys/${created.body.item.id}/stats?window=7d&timezone=${encodeURIComponent(timeZone)}`)
      .expect(200);

    expect(res.body.timeline).toHaveLength(expectedBucketCount);
    expect(res.body.timeline.reduce((sum: number, point: { calls: number }) => sum + point.calls, 0)).toBe(1);
    expect(res.body.timeline.some((point: { calls: number }) => point.calls === 0)).toBe(true);
    expect(res.body.timeline.find((point: { bucket: string; calls: number }) => point.bucket === expectedBucket)?.calls).toBe(1);
    expect(res.body.timeline[res.body.timeline.length - 1]?.bucket).toBe(expectedLastBucket);
  });

  it("returns all-time stats for soft-deleted key", async () => {
    // Create + use + delete a key
    const created = await request(app).post("/api/admin/keys").send({ name: "Deleted Stats", allowed_models: ["gpt-5-mini"], fallback_model: "gpt-5-mini" }).expect(201);
    await request(app)
      .post("/api/v1/chat/completions")
      .set("Authorization", `Bearer ${created.body.rawKey}`)
      .send({ model: "m", messages: [{ role: "user", content: "x" }] })
      .expect(200);
    await request(app).delete(`/api/admin/keys/${created.body.item.id}`).expect(200);

    // Stats should still return (all-time window)
    const res = await request(app).get(`/api/admin/keys/${created.body.item.id}/stats`).expect(200);
    expect(res.body.stats.totalCalls).toBeGreaterThan(0);
  }, 30000);

  // ── History ───────────────────────────────────────────────────────────
  it("paginates request history", async () => {
    const history = await request(app).get(`/api/admin/keys/${keyId}/history?page=1&limit=2`).expect(200);
    expect(history.body.total).toBeGreaterThan(0);
    expect(history.body.items.length).toBeLessThanOrEqual(2);
  });

  // ── proxy_time_ms recorded ────────────────────────────────────────────
  it("records proxy_time_ms >= 0", async () => {
    const history = await request(app).get(`/api/admin/keys/${keyId}/history?page=1&limit=1`).expect(200);
    expect(history.body.items[0].proxy_time_ms).toBeGreaterThanOrEqual(0);
  });

  // ── Response time averages: successful requests only ─────────────────
  it("overview avgResponseTime and avgProxyTime exclude failed requests", async () => {
    const created = await request(app)
      .post("/api/admin/keys")
      .send({ name: "Overview Avg Time Key", allowed_models: ["gpt-5-mini"], fallback_model: "gpt-5-mini" })
      .expect(201);
    const ts = new Date().toISOString();

    // One successful request
    insertSyntheticRequest({ apiKeyId: created.body.item.id, timestamp: ts, success: 1, responseTimeMs: 200, proxyTimeMs: 50 });
    // Two failed requests with very high times (simulate timeouts)
    insertSyntheticRequest({ apiKeyId: created.body.item.id, timestamp: ts, success: 0, responseTimeMs: 300_000, proxyTimeMs: 0, statusCode: 504, errorMessage: "timeout" });
    insertSyntheticRequest({ apiKeyId: created.body.item.id, timestamp: ts, success: 0, responseTimeMs: 50_000, proxyTimeMs: 0, statusCode: 502, errorMessage: "conn refused" });

    const overview = await request(app).get("/api/admin/overview?window=24h&timezone=UTC").expect(200);

    // Find this key in the per-key summaries
    const keySummary = overview.body.keySummaries.find((k: { id: number }) => k.id === created.body.item.id);
    expect(keySummary).toBeDefined();
    // Only the 200ms successful request counts
    expect(keySummary.avgResponseTime).toBe(200);
    expect(keySummary.avgProxyTime).toBe(50);
  });

  it("key list (GET /api/admin/keys) avgResponseTime excludes failed requests", async () => {
    const created = await request(app)
      .post("/api/admin/keys")
      .send({ name: "List Avg Time Key", allowed_models: ["gpt-5-mini"], fallback_model: "gpt-5-mini" })
      .expect(201);
    const ts = new Date().toISOString();

    // Successful request: 100 ms
    insertSyntheticRequest({ apiKeyId: created.body.item.id, timestamp: ts, success: 1, responseTimeMs: 100, proxyTimeMs: 20 });
    // Failed request: 300 000 ms (would dominate if included)
    insertSyntheticRequest({
      apiKeyId: created.body.item.id,
      timestamp: ts,
      success: 0,
      responseTimeMs: 300_000,
      proxyTimeMs: 0,
      statusCode: 504,
      errorMessage: "timeout",
    });

    const list = await request(app).get("/api/admin/keys").expect(200);
    const keyInList = list.body.items.find((k: { id: number }) => k.id === created.body.item.id);
    expect(keyInList).toBeDefined();
    // avgResponseTime must reflect only the 100 ms successful request
    expect(keyInList.avgResponseTime).toBe(100);
  });

  it("timeline buckets avgResponseTime and avgProxyTime exclude failed requests", async () => {
    const created = await request(app)
      .post("/api/admin/keys")
      .send({ name: "Timeline Avg Time Key", allowed_models: ["gpt-5-mini"], fallback_model: "gpt-5-mini" })
      .expect(201);
    const ts = new Date().toISOString();

    insertSyntheticRequest({ apiKeyId: created.body.item.id, timestamp: ts, success: 1, responseTimeMs: 80, proxyTimeMs: 10 });
    insertSyntheticRequest({ apiKeyId: created.body.item.id, timestamp: ts, success: 0, responseTimeMs: 120_000, proxyTimeMs: 0, statusCode: 504, errorMessage: "timeout" });

    const res = await request(app)
      .get(`/api/admin/keys/${created.body.item.id}/stats?window=24h&timezone=UTC`)
      .expect(200);

    // Find the non-empty bucket
    const activeBucket = res.body.timeline.find((b: { calls: number }) => b.calls > 0);
    expect(activeBucket).toBeDefined();
    expect(activeBucket.avgResponseTime).toBe(80);
    expect(activeBucket.avgProxyTime).toBe(10);
  });

  // ── TC-STATS: Per-model timeline ───────────────────────────────────────
  it("TC-STATS-001: returns request_timeline_by_model in key stats", async () => {
    const created = await request(app)
      .post("/api/admin/keys")
      .send({
        name: "Per-Model Stats Key",
        allowed_models: ["gpt-5-mini", "gpt-4o"],
        fallback_model: "gpt-5-mini",
      })
      .expect(201);
    const ts = new Date().toISOString();

    insertSyntheticRequest({ apiKeyId: created.body.item.id, timestamp: ts, success: 1, responseTimeMs: 100, proxyTimeMs: 20, modelUsed: "gpt-5-mini", totalTokens: 10 });
    insertSyntheticRequest({ apiKeyId: created.body.item.id, timestamp: ts, success: 1, responseTimeMs: 150, proxyTimeMs: 30, modelUsed: "gpt-4o", totalTokens: 15 });
    insertSyntheticRequest({ apiKeyId: created.body.item.id, timestamp: ts, success: 0, responseTimeMs: 500, proxyTimeMs: 0, modelUsed: "gpt-5-mini", statusCode: 500 });

    const res = await request(app)
      .get(`/api/admin/keys/${created.body.item.id}/stats?window=24h&timezone=UTC`)
      .expect(200);

    expect(res.body.request_timeline_by_model).toBeDefined();
    expect(Array.isArray(res.body.request_timeline_by_model["gpt-5-mini"])).toBe(true);
    expect(Array.isArray(res.body.request_timeline_by_model["gpt-4o"])).toBe(true);

    const miniTimeline = res.body.request_timeline_by_model["gpt-5-mini"] as Array<{ calls: number }>;
    const gpt4oTimeline = res.body.request_timeline_by_model["gpt-4o"] as Array<{ calls: number }>;

    const miniTotal = miniTimeline.reduce((s: number, b: { calls: number }) => s + b.calls, 0);
    const gpt4oTotal = gpt4oTimeline.reduce((s: number, b: { calls: number }) => s + b.calls, 0);

    expect(miniTotal).toBe(2); // 1 success + 1 failure
    expect(gpt4oTotal).toBe(1);
  });

  it("TC-STATS-002: request_timeline_by_model only contains models in allowed_models", async () => {
    const created = await request(app)
      .post("/api/admin/keys")
      .send({
        name: "Model Filter Stats Key",
        allowed_models: ["gpt-4o"],
        fallback_model: "gpt-4o",
      })
      .expect(201);
    const ts = new Date().toISOString();

    // Insert a request with a model NOT in allowed_models (e.g., old data migration scenario)
    insertSyntheticRequest({ apiKeyId: created.body.item.id, timestamp: ts, success: 1, responseTimeMs: 100, proxyTimeMs: 20, modelUsed: "gpt-4o" });
    insertSyntheticRequest({ apiKeyId: created.body.item.id, timestamp: ts, success: 1, responseTimeMs: 100, proxyTimeMs: 20, modelUsed: "unknown-model" });

    const res = await request(app)
      .get(`/api/admin/keys/${created.body.item.id}/stats?window=24h&timezone=UTC`)
      .expect(200);

    // Only gpt-4o should appear (allowed); unknown-model should not
    expect(res.body.request_timeline_by_model["gpt-4o"]).toBeDefined();
    expect(res.body.request_timeline_by_model["unknown-model"]).toBeUndefined();
  });
});
