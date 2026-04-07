import { test, expect, type Page } from "@playwright/test";

const ADMIN_URL = "http://127.0.0.1:8020"; // Admin API
const CLIENT_URL = "http://127.0.0.1:8022"; // OpenAI-compatible proxy API

async function seedKeyAndTraffic(page: Page) {
  const createResponse = await page.request.post(`${ADMIN_URL}/api/admin/keys`, {
    data: { name: `Dashboard ${Date.now()}`, model: "gpt-5-mini" },
  });
  const created = await createResponse.json();
  const rawKey = created.rawKey as string;
  const keyId = created.item.id as number;

  await page.request.post(`${CLIENT_URL}/api/v1/chat/completions`, {
    headers: { Authorization: `Bearer ${rawKey}` },
    data: { model: "wrong-model", messages: [{ role: "user", content: "hello dashboard" }] },
  });

  await page.request.post(`${CLIENT_URL}/api/v1/chat/completions`, {
    headers: { Authorization: `Bearer ${rawKey}` },
    data: { model: "wrong-model", messages: [{ role: "user", content: "second request" }] },
  });

  return { keyId };
}

test("TC-UI-01/07/08: renders dashboard metrics and key detail timeline", async ({ page }) => {
  await expect.poll(async () => (await page.request.get(`${ADMIN_URL}/health`)).status()).toBe(200);

  const { keyId } = await seedKeyAndTraffic(page);

  // TC-UI-01: Dashboard page renders
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Total Requests", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Success Rate", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Avg Proxy Latency", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Avg Response Time", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Avg Tokens", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();

  // Health indicator should be present
  await expect(page.getByTestId("health-indicator")).toBeVisible();

  // Time window buttons
  await page.getByRole("button", { name: "7d" }).click();
  // Charts should be visible
  await expect(page.getByTestId("timeline-chart").first()).toBeVisible();

  // TC-UI-03/TC-STATS-08: Navigate to key detail and verify timeline
  await page.goto(`/keys/${keyId}`);
  await expect(page.getByText("Key Dashboard")).toBeVisible();
  await expect(page.getByTestId("timeline-chart").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
});

test("TC-UI-04: back navigation from key detail returns to key management", async ({ page }) => {
  await expect.poll(async () => (await page.request.get(`${ADMIN_URL}/health`)).status()).toBe(200);

  const { keyId } = await seedKeyAndTraffic(page);
  await page.goto(`/keys/${keyId}`);
  await expect(page.getByText("Key Dashboard")).toBeVisible();

  await page.getByTitle("Go back").click();
  await expect(page).toHaveURL(/\/keys/);
  await expect(page.getByRole("heading", { name: "API Keys" })).toBeVisible();
});

test("highlights the saved dashboard time window on entry", async ({ page }) => {
  await page.route("**/api/admin/settings", async (route) => {
    await route.fulfill({
      json: {
        copilot_url: "http://127.0.0.1:1288",
        default_model: "gpt-5-mini",
        dashboard_time_window: "30d",
        key_detail_time_window: "24h",
        auto_refresh_interval: "never",
      },
    });
  });

  await page.route("**/api/admin/overview?**", async (route) => {
    await route.fulfill({
      json: {
        defaultModel: "gpt-5-mini",
        summary: {
          totalCalls: 0,
          successRate: 0,
          avgProxyTime: 0,
          avgResponseTime: 0,
          activeKeys: 0,
          avgTokensPerRequest: 0,
          p90ProxyTime: 0,
          p95ProxyTime: 0,
          p99ProxyTime: 0,
          p90ResponseTime: 0,
          p95ResponseTime: 0,
          p99ResponseTime: 0,
          p90Tokens: 0,
          p95Tokens: 0,
          p99Tokens: 0,
        },
        keySummaries: [],
        timeline: [],
      },
    });
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "30d" })).toHaveClass(/active/);
});

test("highlights the saved API key time window on entry", async ({ page }) => {
  await page.route("**/api/admin/settings", async (route) => {
    await route.fulfill({
      json: {
        copilot_url: "http://127.0.0.1:1288",
        default_model: "gpt-5-mini",
        dashboard_time_window: "24h",
        key_detail_time_window: "7d",
        auto_refresh_interval: "never",
      },
    });
  });

  await page.route("**/api/admin/keys/999/stats?**", async (route) => {
    await route.fulfill({
      json: {
        item: {
          id: 999,
          key_hash: "hash",
          key_preview: "cps_test...9999",
          name: "Test Key",
          model: "gpt-5-mini",
          is_active: 1,
          is_deleted: 0,
          created_by_name: "Test User",
          created_by_email: "test@example.com",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_used_at: null,
        },
        stats: {
          totalCalls: 0,
          successRate: 0,
          avgProxyTime: 0,
          avgResponseTime: 0,
          avgTokensPerRequest: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          p90ProxyTime: 0,
          p95ProxyTime: 0,
          p99ProxyTime: 0,
          p90ResponseTime: 0,
          p95ResponseTime: 0,
          p99ResponseTime: 0,
          p90Tokens: 0,
          p95Tokens: 0,
          p99Tokens: 0,
        },
        timeline: [],
        recentErrors: [],
        callsByIpAndHost: [],
      },
    });
  });

  await page.route("**/api/admin/keys/999/history", async (route) => {
    await route.fulfill({ json: { items: [], total: 0 } });
  });

  await page.goto("/keys/999");
  await expect(page.getByRole("button", { name: "7d" })).toHaveClass(/active/);
});
