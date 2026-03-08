/**
 * Proxy Route Tests
 *
 * Tests the /v1/* client API endpoints (protected by API keys).
 * The upstream Copilot Connect server URL is configured via:
 *   - process.env.COPILOT_URL (set in setupEnv.cjs)
 *   - Falls back to http://127.0.0.1:1289 (mock) if not set
 *
 * To test against real Copilot Connect:
 *   COPILOT_URL=http://127.0.0.1:1288 npm run test:api
 *
 * To test against mock (default):
 *   npm run test:api
 */

import request from "supertest";
import { createApp } from "../../server/src/app.js";

describe("proxy routes", () => {
  const app = createApp();
  let rawKey = "";

  beforeAll(async () => {
    const response = await request(app).post("/admin/api/keys").send({ name: "Proxy Key", model: "gpt-5-mini" }).expect(201);
    rawKey = response.body.rawKey;
  });

  it("rejects missing api key", async () => {
    await request(app)
      .post("/v1/chat/completions")
      .send({ model: "ignored-model", messages: [{ role: "user", content: "hi" }] })
      .expect(401);
  });

  it("overrides requested model with configured model", async () => {
    const response = await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${rawKey}`)
      .send({ model: "gpt-4.1", messages: [{ role: "user", content: "ping" }] })
      .expect(200);

    expect(response.body.model).toBe("gpt-5-mini");
    // Mock copilot increments total_tokens; verify token usage is present or 0 is acceptable
    expect(typeof response.body.usage.total_tokens).toBe("number");
    expect(response.body.usage.total_tokens).toBeGreaterThanOrEqual(0);
  }, 10000);
});
