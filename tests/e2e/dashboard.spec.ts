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
