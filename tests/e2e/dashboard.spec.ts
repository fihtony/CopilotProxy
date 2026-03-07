import { test, expect, type Page } from "@playwright/test";

const PROXY_URL = "http://127.0.0.1:3000";

async function seedKeyAndTraffic(page: Page) {
  const createResponse = await page.request.post(`${PROXY_URL}/api/keys`, {
    data: { name: `Dashboard ${Date.now()}`, model: "gpt-5-mini" },
  });
  const created = await createResponse.json();
  const rawKey = created.rawKey as string;
  const keyId = created.item.id as number;

  await page.request.post(`${PROXY_URL}/v1/chat/completions`, {
    headers: { Authorization: `Bearer ${rawKey}` },
    data: { model: "wrong-model", messages: [{ role: "user", content: "hello dashboard" }] },
  });

  await page.request.post(`${PROXY_URL}/v1/chat/completions`, {
    headers: { Authorization: `Bearer ${rawKey}` },
    data: { model: "wrong-model", messages: [{ role: "user", content: "second request" }] },
  });

  return { keyId };
}

test("TC-UI-01/07/08: renders dashboard metrics and key detail timeline", async ({ page }) => {
  await expect.poll(async () => (await page.request.get(`${PROXY_URL}/health`)).status()).toBe(200);

  const { keyId } = await seedKeyAndTraffic(page);

  // TC-UI-01: Dashboard page renders
  await page.goto("/");
  await expect(page.getByText("Dashboard")).toBeVisible();
  await expect(page.getByText("Total Calls", { exact: true })).toBeVisible();
  await expect(page.getByText("Success Rate", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Avg Proxy Latency", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Avg Response Time", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Avg Tokens", { exact: true }).first()).toBeVisible();

  // Health indicator should be present
  await expect(page.getByTestId("health-indicator")).toBeVisible();

  // Time window buttons
  await page.getByRole("button", { name: "7d" }).click();
  // Charts should be visible
  await expect(page.getByTestId("timeline-chart").first()).toBeVisible();

  // TC-UI-03/TC-STATS-08: Navigate to key detail and verify timeline
  await page.goto(`/keys/${keyId}`);
  await expect(page.getByText("Key Dashboard")).toBeVisible();
  await expect(page.getByTestId("timeline-chart")).toBeVisible();
});

test("TC-UI-04: back navigation from key detail returns to key management", async ({ page }) => {
  await expect.poll(async () => (await page.request.get(`${PROXY_URL}/health`)).status()).toBe(200);

  const { keyId } = await seedKeyAndTraffic(page);
  await page.goto(`/keys/${keyId}`);
  await expect(page.getByText("Key Dashboard")).toBeVisible();

  await page.getByRole("link", { name: /back to key management/i }).click();
  await expect(page).toHaveURL(/\/keys/);
  await expect(page.getByText("API Keys")).toBeVisible();
});
