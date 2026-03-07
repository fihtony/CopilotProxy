import request from "supertest";
import { createApp } from "../../server/src/app.js";

describe("stats routes", () => {
  const app = createApp();
  let rawKey = "";
  let keyId = 0;

  beforeAll(async () => {
    const createResponse = await request(app).post("/api/keys").send({ name: "Stats Key", model: "gpt-5-mini" }).expect(201);
    rawKey = createResponse.body.rawKey;
    keyId = createResponse.body.item.id;

    // Fire several requests to produce stats
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/v1/chat/completions")
        .set("Authorization", `Bearer ${rawKey}`)
        .send({ model: "ignored", messages: [{ role: "user", content: `msg-${i}` }] })
        .expect(200);
    }
  }, 30000); // Increase timeout for this hook

  // ── Overview ──────────────────────────────────────────────────────────
  it("returns overview with summary, p-values and timeline", async () => {
    const overview = await request(app).get("/api/overview?window=24h").expect(200);

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

    // Key summaries
    expect(Array.isArray(overview.body.keySummaries)).toBe(true);
  });

  it("supports 90d window", async () => {
    const res = await request(app).get("/api/overview?window=90d").expect(200);
    expect(res.body.summary.totalCalls).toBeGreaterThan(0);
  });

  // ── Key stats ─────────────────────────────────────────────────────────
  it("returns key stats with p-values and errors list", async () => {
    const res = await request(app).get(`/api/keys/${keyId}/stats?window=24h`).expect(200);

    expect(res.body.stats.totalCalls).toBeGreaterThan(0);
    expect(typeof res.body.stats.avgProxyTime).toBe("number");
    expect(typeof res.body.stats.avgTokensPerRequest).toBe("number");
    expect(typeof res.body.stats.p90ProxyTime).toBe("number");

    expect(Array.isArray(res.body.timeline)).toBe(true);
    expect(Array.isArray(res.body.recentErrors)).toBe(true);
    expect(res.body.item).toBeDefined();
  });

  it("returns all-time stats for soft-deleted key", async () => {
    // Create + use + delete a key
    const created = await request(app).post("/api/keys").send({ name: "Deleted Stats", model: "gpt-5-mini" }).expect(201);
    await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${created.body.rawKey}`)
      .send({ model: "m", messages: [{ role: "user", content: "x" }] })
      .expect(200);
    await request(app).delete(`/api/keys/${created.body.item.id}`).expect(200);

    // Stats should still return (all-time window)
    const res = await request(app).get(`/api/keys/${created.body.item.id}/stats`).expect(200);
    expect(res.body.stats.totalCalls).toBeGreaterThan(0);
  });

  // ── History ───────────────────────────────────────────────────────────
  it("paginates request history", async () => {
    const history = await request(app).get(`/api/keys/${keyId}/history?page=1&limit=2`).expect(200);
    expect(history.body.total).toBeGreaterThan(0);
    expect(history.body.items.length).toBeLessThanOrEqual(2);
  });

  // ── proxy_time_ms recorded ────────────────────────────────────────────
  it("records proxy_time_ms >= 0", async () => {
    const history = await request(app).get(`/api/keys/${keyId}/history?page=1&limit=1`).expect(200);
    expect(history.body.items[0].proxy_time_ms).toBeGreaterThanOrEqual(0);
  });
});
