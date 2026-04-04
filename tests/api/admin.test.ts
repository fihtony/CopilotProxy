/// <reference types="jest" />

/**
 * Admin Routes Tests
 *
 * Tests the /api/* endpoints on the admin app (protected by cloudflareAuthMiddleware).
 * In development, middleware attaches LOCAL_ADMIN_USER: { name: "Local", email: "admin@localhost.com" }
 * Tests override this in beforeAll() to { name: "Test User", email: "test@localhost.com" }
 *
 * Upstream Copilot Connect server URL:
 *   - process.env.COPILOT_URL (set in setupEnv.cjs, defaults to http://127.0.0.1:1288)
 *
 * Tests run against CopilotConnect in echo mode (no real Copilot requests consumed).
 * Ensure CopilotConnect is running before executing tests.
 */

import request from "supertest";
import { createServer } from "node:http";
import { createApp } from "../../server/src/app.js";
import { LOCAL_ADMIN_USER } from "../../server/src/middleware/cloudflareAuth.js";
import { updateSettingsInDb } from "../../server/src/db/database.js";
import { getSettings } from "../../server/src/services/settingsService.js";

describe("admin routes", () => {
  const app = createApp();

  beforeAll(() => {
    // Override LOCAL_ADMIN_USER for tests so assertions are deterministic.
    LOCAL_ADMIN_USER.name = "Test User";
    LOCAL_ADMIN_USER.email = "test@localhost.com";
  });

  afterAll(() => {
    // Restore original values for cleanup.
    LOCAL_ADMIN_USER.name = "Local";
    LOCAL_ADMIN_USER.email = "admin@localhost.com";
  });

  // ── Health endpoint ─────────────────────────────────────────────────────
  it("GET /health returns ok:true and launch_time in YYYY/MM/DD HH:MM:SS format", async () => {
    const res = await request(app).get("/health").expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.launch_time).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  // ── Key CRUD ────────────────────────────────────────────────────────────
  it("creates and lists api keys", async () => {
    const createResponse = await request(app).post("/api/admin/keys").send({ name: "Test Key", model: "gpt-5-mini" }).expect(201);

    expect(createResponse.body.rawKey).toMatch(/^cps_/);
    // LOCAL_ADMIN_USER is overridden to test user in beforeAll.
    expect(createResponse.body.item.created_by_name).toBe("Test User");
    expect(createResponse.body.item.created_by_email).toBe("test@localhost.com");

    const listResponse = await request(app).get("/api/admin/keys").expect(200);
    expect(Array.isArray(listResponse.body.items)).toBe(true);
    expect(listResponse.body.items.some((item: { name: string }) => item.name === "Test Key")).toBe(true);
  });

  it("creates key with default model from settings", async () => {
    const res = await request(app).post("/api/admin/keys").send({ name: "Default Model Key" }).expect(201);
    expect(res.body.item.model).toBe("gpt-5-mini");
  });

  it("created_by is stored and returned via stats endpoint", async () => {
    const created = await request(app).post("/api/admin/keys").send({ name: "Stats Key", model: "gpt-5-mini" }).expect(201);
    expect(created.body.item.created_by_name).toBe("Test User");
    expect(created.body.item.created_by_email).toBe("test@localhost.com");

    const stats = await request(app).get(`/api/admin/keys/${created.body.item.id}/stats`).expect(200);
    expect(stats.body.item.created_by_name).toBe("Test User");
    expect(stats.body.item.created_by_email).toBe("test@localhost.com");
  });

  it("rejects invalid create payload", async () => {
    await request(app).post("/api/admin/keys").send({}).expect(400);
    await request(app).post("/api/admin/keys").send({ name: "" }).expect(400);
    await request(app).post("/api/admin/keys").send({ name: "a".repeat(256) }).expect(400);
    await request(app).post("/api/admin/keys").send({ name: "Valid", model: "m".repeat(256) }).expect(400);
  });

  it("lists keys with search filter", async () => {
    await request(app).post("/api/admin/keys").send({ name: "SearchMe" }).expect(201);
    const res = await request(app).get("/api/admin/keys?search=SearchMe").expect(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((k: { name: string }) => k.name.includes("SearchMe"))).toBe(true);
  });

  it("lists keys with sort", async () => {
    const res = await request(app).get("/api/admin/keys?sortBy=name&sortDir=asc").expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("patches an existing key", async () => {
    const created = await request(app).post("/api/admin/keys").send({ name: "PatchTarget", model: "gpt-5-mini" }).expect(201);
    const patched = await request(app).patch(`/api/admin/keys/${created.body.item.id}`).send({ name: "Patched" }).expect(200);
    expect(patched.body.item.name).toBe("Patched");
  });

  // ── Soft delete ─────────────────────────────────────────────────────────
  it("soft-deletes an api key (200, not 204)", async () => {
    const created = await request(app).post("/api/admin/keys").send({ name: "DeleteMe", model: "gpt-5-mini" }).expect(201);
    const del = await request(app).delete(`/api/admin/keys/${created.body.item.id}`).expect(200);
    expect(del.body.ok).toBe(true);

    // Key should still appear in list with is_deleted = 1
    const list = await request(app).get("/api/admin/keys").expect(200);
    const found = list.body.items.find((k: { id: number }) => k.id === created.body.item.id);
    expect(found).toBeDefined();
    expect(found.is_deleted).toBe(1);
    expect(found.is_active).toBe(0);
  });

  it("soft-deleted key is rejected by proxy", async () => {
    const created = await request(app).post("/api/admin/keys").send({ name: "ProxyReject", model: "gpt-5-mini" }).expect(201);
    await request(app).delete(`/api/admin/keys/${created.body.item.id}`).expect(200);

    await request(app)
      .post("/api/v1/chat/completions")
      .set("Authorization", `Bearer ${created.body.rawKey}`)
      .send({ model: "m", messages: [{ role: "user", content: "hi" }] })
      .expect(401);
  });

  it("returns 404 when deleting non-existent key", async () => {
    await request(app).delete("/api/admin/keys/999999").expect(404);
  });

  // ── Settings ────────────────────────────────────────────────────────────
  it("reads default settings", async () => {
    const res = await request(app).get("/api/admin/settings").expect(200);
    expect(res.body.copilot_url).toBeDefined();
    expect(res.body.default_model).toBeDefined();
  });

  it("updates settings", async () => {
    const res = await request(app).put("/api/admin/settings").send({ default_model: "gpt-4o" }).expect(200);
    expect(res.body.default_model).toBe("gpt-4o");

    // Restore
    await request(app).put("/api/admin/settings").send({ default_model: "gpt-5-mini" }).expect(200);
  });

  it("rejects invalid settings", async () => {
    await request(app).put("/api/admin/settings").send({ copilot_url: "not-a-url" }).expect(400);
    await request(app).put("/api/admin/settings").send({ default_model: "m".repeat(256) }).expect(400);
  });

  it("sanitizes an unsafe stored upstream URL before returning settings", async () => {
    const safeUrl = getSettings().copilot_url;
    updateSettingsInDb({ copilot_url: "http://169.254.169.254" });

    const res = await request(app).get("/api/admin/settings").expect(200);
    expect(res.body.copilot_url).toBe(safeUrl);
  });

  // ── Upstream health ─────────────────────────────────────────────────────
  it("checks copilot upstream health", async () => {
    const res = await request(app).get("/api/admin/health/copilot").expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(res.body.models)).toBe(true);
  });

  it("rejects blocked metadata URLs when testing an unsaved upstream", async () => {
    await request(app).post("/api/admin/health/copilot").send({ copilot_url: "http://169.254.169.254" }).expect(400);
  });

  it("does not follow upstream redirects during health checks", async () => {
    const redirectServer = createServer((_req, res) => {
      res.statusCode = 302;
      res.setHeader("Location", "http://169.254.169.254/latest/meta-data");
      res.end();
    });

    await new Promise<void>((resolve) => redirectServer.listen(0, "127.0.0.1", resolve));
    const address = redirectServer.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
      const res = await request(app)
        .post("/api/admin/health/copilot")
        .send({ copilot_url: `http://127.0.0.1:${port}` })
        .expect(200);

      expect(res.body.ok).toBe(false);
      expect(res.body.status).toBe(302);
    } finally {
      await new Promise<void>((resolve, reject) => {
        redirectServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});
