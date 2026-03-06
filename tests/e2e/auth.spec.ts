import { test, expect } from "@playwright/test";

// TC-AUTH: authentication and authorization scenarios

const PROXY_URL = "http://127.0.0.1:3000";

test.describe("Authentication - no key", () => {
  test("TC-AUTH-01: request without API key returns 401", async ({ request }) => {
    const response = await request.post(`${PROXY_URL}/v1/chat/completions`, {
      data: { model: "gpt-5-mini", messages: [{ role: "user", content: "hello" }] },
    });
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error.message).toMatch(/missing bearer/i);
  });
});

test.describe("Authentication - invalid key", () => {
  test("TC-AUTH-02: request with invalid API key returns 401", async ({ request }) => {
    const response = await request.post(`${PROXY_URL}/v1/chat/completions`, {
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
    const create = await request.post(`${PROXY_URL}/api/keys`, {
      data: { name: `Disabled Key ${Date.now()}`, model: "gpt-5-mini" },
    });
    expect(create.status()).toBe(201);
    const { item, rawKey } = await create.json();

    // Disable the key
    const patch = await request.patch(`${PROXY_URL}/api/keys/${item.id}`, {
      data: { is_active: 0 },
    });
    expect(patch.status()).toBe(200);

    // Attempt to use the disabled key
    const response = await request.post(`${PROXY_URL}/v1/chat/completions`, {
      headers: { Authorization: `Bearer ${rawKey}` },
      data: { model: "gpt-5-mini", messages: [{ role: "user", content: "hello" }] },
    });
    expect(response.status()).toBe(401);

    // Cleanup
    await request.delete(`${PROXY_URL}/api/keys/${item.id}`);
  });
});

test.describe("Authentication - valid key", () => {
  let rawKey = "";
  let keyId = 0;

  test.beforeAll(async ({ request }) => {
    const create = await request.post(`${PROXY_URL}/api/keys`, {
      data: { name: `Auth Key ${Date.now()}`, model: "gpt-5-mini" },
    });
    const body = await create.json();
    rawKey = body.rawKey;
    keyId = body.item.id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${PROXY_URL}/api/keys/${keyId}`);
  });

  test("TC-AUTH-04: request with valid key returns 200", async ({ request }) => {
    const response = await request.post(`${PROXY_URL}/v1/chat/completions`, {
      headers: { Authorization: `Bearer ${rawKey}` },
      data: { model: "gpt-5-mini", messages: [{ role: "user", content: "ping" }] },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.object).toBe("chat.completion");
  });

  test("TC-AUTH-05: key model overrides request model", async ({ request }) => {
    const response = await request.post(`${PROXY_URL}/v1/chat/completions`, {
      headers: { Authorization: `Bearer ${rawKey}` },
      data: { model: "override-attempt", messages: [{ role: "user", content: "models?" }] },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    // The key is bound to gpt-5-mini; the request model must be ignored.
    expect(body.model).toBe("gpt-5-mini");
  });

  test("TC-AUTH-06: GET /v1/models requires valid key", async ({ request }) => {
    // Without auth
    const noAuth = await request.get(`${PROXY_URL}/v1/models`);
    expect(noAuth.status()).toBe(401);

    // With valid key
    const withAuth = await request.get(`${PROXY_URL}/v1/models`, {
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    expect(withAuth.status()).toBe(200);
    const body = await withAuth.json();
    expect(body.object).toBe("list");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });
});
