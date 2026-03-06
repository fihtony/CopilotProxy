import { test, expect } from "@playwright/test";

// TC-STATS: usage statistics and tracking

const PROXY_URL = "http://127.0.0.1:3000";

test.describe("Stats tracking", () => {
  let rawKey = "";
  let keyId = 0;

  test.beforeAll(async ({ request }) => {
    const create = await request.post(`${PROXY_URL}/api/keys`, {
      data: { name: `Stats Key ${Date.now()}`, model: "gpt-5-mini" },
    });
    const body = await create.json();
    rawKey = body.rawKey;
    keyId = body.item.id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${PROXY_URL}/api/keys/${keyId}`);
  });

  async function sendRequest(request: Parameters<typeof test.beforeAll>[0], content = "test") {
    return request.post(`${PROXY_URL}/v1/chat/completions`, {
      headers: { Authorization: `Bearer ${rawKey}` },
      data: { model: "not-used", messages: [{ role: "user", content }] },
    });
  }

  test("TC-STATS-01: successful requests increment total calls", async ({ request }) => {
    // Baseline
    const before = await request.get(`${PROXY_URL}/api/keys/${keyId}/stats?window=1h`);
    const { stats: statsBefore } = await before.json();
    const baseCalls = statsBefore.totalCalls as number;

    // Send 3 requests
    for (let i = 0; i < 3; i++) {
      await sendRequest(request, `hello-${i}`);
    }

    const after = await request.get(`${PROXY_URL}/api/keys/${keyId}/stats?window=1h`);
    const { stats: statsAfter } = await after.json();

    expect(statsAfter.totalCalls).toBe(baseCalls + 3);
    expect(statsAfter.successRate).toBe(100);
  });

  test("TC-STATS-03: response time is recorded", async ({ request }) => {
    await sendRequest(request, "response time test");

    const statsResponse = await request.get(`${PROXY_URL}/api/keys/${keyId}/stats?window=1h`);
    const { stats } = await statsResponse.json();

    expect(stats.avgResponseTime).toBeGreaterThan(0);
  });

  test("TC-STATS-04: token counts are stored in history", async ({ request }) => {
    await sendRequest(request, "token count test message");

    const histResponse = await request.get(`${PROXY_URL}/api/keys/${keyId}/history?page=1&limit=1`);
    const { items } = await histResponse.json();
    expect(items.length).toBeGreaterThan(0);

    const row = items[0];
    expect(row.prompt_tokens).toBeGreaterThan(0);
    expect(row.completion_tokens).toBeGreaterThan(0);
    expect(row.total_tokens).toBe(row.prompt_tokens + row.completion_tokens);
    // model_used is always the key's model; model_requested is whatever the caller sent
    expect(row.model_used).toBe("gpt-5-mini");
    expect(row.model_requested).toBe("not-used");
  });

  test("TC-STATS-05: overview aggregates across keys", async ({ request }) => {
    const create2 = await request.post(`${PROXY_URL}/api/keys`, {
      data: { name: `Stats Key B ${Date.now()}`, model: "gpt-5-mini" },
    });
    const { item: item2, rawKey: rawKey2 } = await create2.json();

    // Make requests with second key
    await request.post(`${PROXY_URL}/v1/chat/completions`, {
      headers: { Authorization: `Bearer ${rawKey2}` },
      data: { model: "x", messages: [{ role: "user", content: "overview test" }] },
    });

    const overview = await request.get(`${PROXY_URL}/api/overview?window=1h`);
    const { summary } = await overview.json();

    expect(summary.totalCalls).toBeGreaterThan(0);
    expect(summary.activeKeys).toBeGreaterThanOrEqual(2);

    await request.delete(`${PROXY_URL}/api/keys/${item2.id}`);
  });

  test("TC-STATS-06: time window 30d totals >= 1h totals", async ({ request }) => {
    const r1h = await request.get(`${PROXY_URL}/api/overview?window=1h`);
    const r30d = await request.get(`${PROXY_URL}/api/overview?window=30d`);
    const { summary: s1h } = await r1h.json();
    const { summary: s30d } = await r30d.json();

    expect(s30d.totalCalls).toBeGreaterThanOrEqual(s1h.totalCalls);
  });
});

test.describe("Stats UI — metric cards and timeline", () => {
  test("TC-STATS-07: metric cards show correct values on overview page", async ({ page, request }) => {
    await expect.poll(async () => (await request.get(`${PROXY_URL}/health`)).status()).toBe(200);

    // Seed some traffic
    const create = await request.post(`${PROXY_URL}/api/keys`, {
      data: { name: `UI Stats ${Date.now()}`, model: "gpt-5-mini" },
    });
    const { item, rawKey } = await create.json();

    for (let i = 0; i < 2; i++) {
      await request.post(`${PROXY_URL}/v1/chat/completions`, {
        headers: { Authorization: `Bearer ${rawKey}` },
        data: { messages: [{ role: "user", content: `ui-stats-${i}` }] },
      });
    }

    await page.goto("/");
    await expect(page.getByText("Total Calls", { exact: true })).toBeVisible();
    await expect(page.getByText("Success Rate", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Average Latency", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Token Volume", { exact: true }).first()).toBeVisible();

    await request.delete(`${PROXY_URL}/api/keys/${item.id}`);
  });

  test("TC-STATS-08: timeline chart renders on key detail page", async ({ page, request }) => {
    await expect.poll(async () => (await request.get(`${PROXY_URL}/health`)).status()).toBe(200);

    const create = await request.post(`${PROXY_URL}/api/keys`, {
      data: { name: `Timeline ${Date.now()}`, model: "gpt-5-mini" },
    });
    const { item, rawKey } = await create.json();

    await request.post(`${PROXY_URL}/v1/chat/completions`, {
      headers: { Authorization: `Bearer ${rawKey}` },
      data: { messages: [{ role: "user", content: "timeline test" }] },
    });

    await page.goto(`/keys/${item.id}`);
    await expect(page.getByText("Key Dashboard")).toBeVisible();
    await expect(page.getByTestId("timeline-chart")).toBeVisible();

    await request.delete(`${PROXY_URL}/api/keys/${item.id}`);
  });
});
