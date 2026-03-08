/**
 * Admin Routes Tests
 *
 * Tests the /admin/api/* endpoints (protected by cloudflareAuthMiddleware).
 * In development, middleware attaches LOCAL_ADMIN_USER: { name: "Local", email: "admin@localhost.com" }
 * Tests override this in beforeAll() to { name: "Test User", email: "test@localhost.com" }
 *
 * Upstream Copilot Connect server URL:
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
import { LOCAL_ADMIN_USER } from "../../server/src/middleware/cloudflareAuth.js";

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

  // ── Key CRUD ────────────────────────────────────────────────────────────
  it("creates and lists api keys", async () => {
    const createResponse = await request(app).post("/admin/api/keys").send({ name: "Test Key", model: "gpt-5-mini" }).expect(201);

    expect(createResponse.body.rawKey).toMatch(/^cps_/);
    // LOCAL_ADMIN_USER is overridden to test user in beforeAll.
    expect(createResponse.body.item.created_by_name).toBe("Test User");
    expect(createResponse.body.item.created_by_email).toBe("test@localhost.com");

    const listResponse = await request(app).get("/admin/api/keys").expect(200);
    expect(Array.isArray(listResponse.body.items)).toBe(true);
    expect(listResponse.body.items.some((item: { name: string }) => item.name === "Test Key")).toBe(true);
  });

  it("creates key with default model from settings", async () => {
    const res = await request(app).post("/admin/api/keys").send({ name: "Default Model Key" }).expect(201);
    expect(res.body.item.model).toBe("gpt-5-mini");
  });

  it("created_by is stored and returned via stats endpoint", async () => {
    const created = await request(app).post("/admin/api/keys").send({ name: "Stats Key", model: "gpt-5-mini" }).expect(201);
    expect(created.body.item.created_by_name).toBe("Test User");
    expect(created.body.item.created_by_email).toBe("test@localhost.com");

    const stats = await request(app).get(`/admin/api/keys/${created.body.item.id}/stats`).expect(200);
    expect(stats.body.item.created_by_name).toBe("Test User");
    expect(stats.body.item.created_by_email).toBe("test@localhost.com");
  });

  it("rejects invalid create payload", async () => {
    await request(app).post("/admin/api/keys").send({}).expect(400);
    await request(app).post("/admin/api/keys").send({ name: "" }).expect(400);
  });

  it("lists keys with search filter", async () => {
    await request(app).post("/admin/api/keys").send({ name: "SearchMe" }).expect(201);
    const res = await request(app).get("/admin/api/keys?search=SearchMe").expect(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((k: { name: string }) => k.name.includes("SearchMe"))).toBe(true);
  });

  it("lists keys with sort", async () => {
    const res = await request(app).get("/admin/api/keys?sortBy=name&sortDir=asc").expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("patches an existing key", async () => {
    const created = await request(app).post("/admin/api/keys").send({ name: "PatchTarget", model: "gpt-5-mini" }).expect(201);
    const patched = await request(app).patch(`/admin/api/keys/${created.body.item.id}`).send({ name: "Patched" }).expect(200);
    expect(patched.body.item.name).toBe("Patched");
  });

  // ── Soft delete ─────────────────────────────────────────────────────────
  it("soft-deletes an api key (200, not 204)", async () => {
    const created = await request(app).post("/admin/api/keys").send({ name: "DeleteMe", model: "gpt-5-mini" }).expect(201);
    const del = await request(app).delete(`/admin/api/keys/${created.body.item.id}`).expect(200);
    expect(del.body.ok).toBe(true);

    // Key should still appear in list with is_deleted = 1
    const list = await request(app).get("/admin/api/keys").expect(200);
    const found = list.body.items.find((k: { id: number }) => k.id === created.body.item.id);
    expect(found).toBeDefined();
    expect(found.is_deleted).toBe(1);
    expect(found.is_active).toBe(0);
  });

  it("soft-deleted key is rejected by proxy", async () => {
    const created = await request(app).post("/admin/api/keys").send({ name: "ProxyReject", model: "gpt-5-mini" }).expect(201);
    await request(app).delete(`/admin/api/keys/${created.body.item.id}`).expect(200);

    await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${created.body.rawKey}`)
      .send({ model: "m", messages: [{ role: "user", content: "hi" }] })
      .expect(401);
  });

  it("returns 404 when deleting non-existent key", async () => {
    await request(app).delete("/admin/api/keys/999999").expect(404);
  });

  // ── Settings ────────────────────────────────────────────────────────────
  it("reads default settings", async () => {
    const res = await request(app).get("/admin/api/settings").expect(200);
    expect(res.body.copilot_url).toBeDefined();
    expect(res.body.default_model).toBeDefined();
  });

  it("updates settings", async () => {
    const res = await request(app).put("/admin/api/settings").send({ default_model: "gpt-4o" }).expect(200);
    expect(res.body.default_model).toBe("gpt-4o");

    // Restore
    await request(app).put("/admin/api/settings").send({ default_model: "gpt-5-mini" }).expect(200);
  });

  it("rejects invalid settings", async () => {
    await request(app).put("/admin/api/settings").send({ copilot_url: "not-a-url" }).expect(400);
  });

  // ── Upstream health ─────────────────────────────────────────────────────
  it("checks copilot upstream health", async () => {
    const res = await request(app).get("/admin/api/health/copilot").expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(res.body.models)).toBe(true);
  });
});
