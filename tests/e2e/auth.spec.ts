import { test, expect } from "@playwright/test";

// TC-AUTH: authentication and authorization scenarios

const ADMIN_URL = "http://127.0.0.1:8020"; // Admin API
const CLIENT_URL = "http://127.0.0.1:8022"; // OpenAI-compatible proxy API

test.describe("Authentication - no key", () => {
  test("TC-AUTH-01: request without API key returns 401", async ({ request }) => {
    const response = await request.post(`${CLIENT_URL}/api/v1/chat/completions`, {
      data: { model: "gpt-5-mini", messages: [{ role: "user", content: "hello" }] },
    });
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error.message).toMatch(/missing bearer/i);
  });
});

test.describe("Authentication - invalid key", () => {
  test("TC-AUTH-02: request with invalid API key returns 401", async ({ request }) => {
    const response = await request.post(`${CLIENT_URL}/api/v1/chat/completions`, {
      headers: { Authorization: "Bearer cps_ffffffffffffffffffffffffffffffff" },
      data: { model: "gpt-5-mini", messages: [{ role: "user", content: "hello" }] },
    });
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error.message).toMatch(/invalid or inactive/i);
  });
});

test.describe("Authentication - disabled key", () => {
  test("TC-AUTH-03: request with disabled key returns 401", async ({ request }) => {
    // Create a key
    const create = await request.post(`${ADMIN_URL}/api/admin/keys`, {
      data: { name: `Disabled Key ${Date.now()}`, model: "gpt-5-mini" },
    });
    expect(create.status()).toBe(201);
    const { item, rawKey } = await create.json();

    // Disable the key
    const patch = await request.patch(`${ADMIN_URL}/api/admin/keys/${item.id}`, {
      data: { is_active: 0 },
    });
    expect(patch.status()).toBe(200);

    // Attempt to use the disabled key
    const response = await request.post(`${CLIENT_URL}/api/v1/chat/completions`, {
      headers: { Authorization: `Bearer ${rawKey}` },
      data: { model: "gpt-5-mini", messages: [{ role: "user", content: "hello" }] },
    });
    expect(response.status()).toBe(401);

    // Cleanup
    await request.delete(`${ADMIN_URL}/api/admin/keys/${item.id}`);
  });
});

test.describe("Authentication - valid key", () => {
  let rawKey = "";
  let keyId = 0;

  test.beforeAll(async ({ request }) => {
    const create = await request.post(`${ADMIN_URL}/api/admin/keys`, {
      data: { name: `Auth Key ${Date.now()}`, model: "gpt-5-mini" },
    });
    const body = await create.json();
    rawKey = body.rawKey;
    keyId = body.item.id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${ADMIN_URL}/api/admin/keys/${keyId}`);
  });

  test("TC-AUTH-04: request with valid key returns 200", async ({ request }) => {
    const response = await request.post(`${CLIENT_URL}/api/v1/chat/completions`, {
      headers: { Authorization: `Bearer ${rawKey}` },
      data: { model: "gpt-5-mini", messages: [{ role: "user", content: "ping" }] },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.object).toBe("chat.completion");
  });

  test("TC-AUTH-05: key model overrides request model", async ({ request }) => {
    const response = await request.post(`${CLIENT_URL}/api/v1/chat/completions`, {
      headers: { Authorization: `Bearer ${rawKey}` },
      data: { model: "override-attempt", messages: [{ role: "user", content: "models?" }] },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    // The key is bound to gpt-5-mini; the request model must be ignored.
    expect(body.model).toBe("gpt-5-mini");
  });

  test("TC-AUTH-06: GET /api/v1/models requires valid key", async ({ request }) => {
    // Without auth
    const noAuth = await request.get(`${CLIENT_URL}/api/v1/models`);
    expect(noAuth.status()).toBe(401);

    // With valid key
    const withAuth = await request.get(`${CLIENT_URL}/api/v1/models`, {
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    expect(withAuth.status()).toBe(200);
    const body = await withAuth.json();
    expect(body.object).toBe("list");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });
});
