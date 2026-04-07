/**
 * Proxy Route Tests
 *
 * Tests the /v1/* client API endpoints (protected by API keys) on the client app.
 * Admin API (/api/*) on the admin app is used to set up test keys.
 *
 * Upstream Copilot Connect server URL:
 *   - process.env.COPILOT_URL (set in setupEnv.cjs, defaults to http://127.0.0.1:1288)
 *
 * Tests run against CopilotConnect in echo mode (no real Copilot requests consumed).
 * Ensure CopilotConnect is running before executing tests.
 */

import { createServer } from "node:http";
import request from "supertest";
import { createApp } from "../../server/src/app.js";
import { updateSettings, getSettings } from "../../server/src/services/settingsService.js";
import { db } from "../../server/src/db/database.js";

describe("proxy routes", () => {
  const app = createApp();
  let rawKey = "";

  beforeAll(async () => {
    const response = await request(app).post("/api/admin/keys").send({ name: "Proxy Key", model: "gpt-5-mini" }).expect(201);
    rawKey = response.body.rawKey;
  });

  it("rejects missing api key", async () => {
    await request(app)
      .post("/api/v1/chat/completions")
      .send({ model: "ignored-model", messages: [{ role: "user", content: "hi" }] })
      .expect(401);
  });

  it("overrides requested model with configured model", async () => {
    const response = await request(app)
      .post("/api/v1/chat/completions")
      .set("Authorization", `Bearer ${rawKey}`)
      .send({ model: "gpt-4.1", messages: [{ role: "user", content: "ping" }] })
      .expect(200);

    expect(response.body.model).toBe("gpt-5-mini");
    // Mock copilot increments total_tokens; verify token usage is present or 0 is acceptable
    expect(typeof response.body.usage.total_tokens).toBe("number");
    expect(response.body.usage.total_tokens).toBeGreaterThanOrEqual(0);
  }, 10000);
});

describe("proxy timeout and connection error handling", () => {
  const app = createApp();
  let rawKey = "";
  let keyId = 0;
  let originalCopilotUrl = "";

  beforeAll(async () => {
    const response = await request(app).post("/api/admin/keys").send({ name: "Timeout Test Key", model: "gpt-5-mini" }).expect(201);
    rawKey = response.body.rawKey;
    keyId = response.body.item.id;
    originalCopilotUrl = getSettings().copilot_url;
  });

  afterEach(() => {
    // Restore the copilot URL and timeout after each test
    updateSettings({ copilot_url: originalCopilotUrl });
    delete process.env.PROXY_TIMEOUT_MS;
  });

  it("returns 504 and records failed request when upstream times out (non-streaming)", async () => {
    // Create a server that accepts the TCP connection but never sends a response.
    const hangingServer = createServer((_req, _res) => { /* hang intentionally */ });
    await new Promise<void>((resolve) => hangingServer.listen(0, "127.0.0.1", resolve));
    const { port } = hangingServer.address() as { port: number };

    updateSettings({ copilot_url: `http://127.0.0.1:${port}` });
    // Short timeout so the test completes quickly
    process.env.PROXY_TIMEOUT_MS = "400";

    try {
      const res = await request(app)
        .post("/api/v1/chat/completions")
        .set("Authorization", `Bearer ${rawKey}`)
        .send({ messages: [{ role: "user", content: "hi" }] })
        .timeout(5000);

      expect(res.status).toBe(504);
      expect(res.body.error.message).toMatch(/timed out/i);

      // Verify the failure was recorded in the DB with success=0
      const history = await request(app)
        .get(`/api/admin/keys/${keyId}/history?page=1&limit=10`)
        .expect(200);

      const timeoutEntry = history.body.items.find(
        (item: { status_code: number; success: number }) => item.status_code === 504 && item.success === 0,
      );
      expect(timeoutEntry).toBeDefined();
      // response_time_ms must be a reasonable value — nowhere near millions of seconds
      expect(timeoutEntry.response_time_ms).toBeGreaterThan(0);
      expect(timeoutEntry.response_time_ms).toBeLessThan(60_000);
    } finally {
      await new Promise<void>((resolve) => hangingServer.close(() => resolve()));
    }
  }, 10_000);

  it("returns 502 and records failed request when upstream refuses connection", async () => {
    // Point to a port that is definitely not listening
    updateSettings({ copilot_url: "http://127.0.0.1:19999" });

    const res = await request(app)
      .post("/api/v1/chat/completions")
      .set("Authorization", `Bearer ${rawKey}`)
      .send({ messages: [{ role: "user", content: "hi" }] })
      .timeout(5000);

    expect(res.status).toBe(502);
    expect(res.body.error.message).toMatch(/failed/i);

    // Verify the failure was recorded with success=0
    const history = await request(app)
      .get(`/api/admin/keys/${keyId}/history?page=1&limit=10`)
      .expect(200);
    const connRefused = history.body.items.find(
      (item: { status_code: number; success: number }) => item.status_code === 502 && item.success === 0,
    );
    expect(connRefused).toBeDefined();
  }, 10_000);

  it("timeout and connection failures do not inflate avgResponseTime in key list", async () => {
    // Create a dedicated key so its stats are isolated
    const created = await request(app)
      .post("/api/admin/keys")
      .send({ name: "Avg Time Isolation Key", model: "gpt-5-mini" })
      .expect(201);
    const isolatedKeyId: number = created.body.item.id;
    const now = new Date().toISOString();

    // Insert one successful request with known low response time
    db.prepare(
      `INSERT INTO requests (api_key_id, timestamp, method, path, status_code, success,
        response_time_ms, proxy_time_ms, prompt_tokens, completion_tokens, total_tokens,
        model_requested, model_used, error_message, ip_address, host)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(isolatedKeyId, now, "POST", "/api/v1/chat/completions", 200, 1, 150, 30, 0, 0, 0, null, "gpt-5-mini", null, "127.0.0.1", "localhost");

    // Insert a timed-out request with a very high response_time_ms
    db.prepare(
      `INSERT INTO requests (api_key_id, timestamp, method, path, status_code, success,
        response_time_ms, proxy_time_ms, prompt_tokens, completion_tokens, total_tokens,
        model_requested, model_used, error_message, ip_address, host)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      isolatedKeyId,
      now,
      "POST",
      "/api/v1/chat/completions",
      504,
      0,
      300_000,
      0,
      0,
      0,
      0,
      null,
      "gpt-5-mini",
      "timeout",
      "127.0.0.1",
      "localhost",
    );

    const list = await request(app).get("/api/admin/keys").expect(200);
    const keyInList = list.body.items.find((k: { id: number }) => k.id === isolatedKeyId);
    expect(keyInList).toBeDefined();
    // Average should only include the successful 150 ms request, not the 300 000 ms timeout
    expect(keyInList.avgResponseTime).toBe(150);
  });
});
