import { test, expect } from "@playwright/test";

const PROXY_URL = "http://127.0.0.1:3000";

test.describe("Settings page", () => {
  test("TC-SET-01: reads and displays current settings", async ({ page }) => {
    await expect.poll(async () => (await page.request.get(`${PROXY_URL}/health`)).status()).toBe(200);

    await page.goto("/settings");
    await expect(page.getByText("Settings")).toBeVisible();
    await expect(page.getByTestId("settings-url")).toBeVisible();
  });

  test("TC-SET-02: test connection shows model list", async ({ page }) => {
    await expect.poll(async () => (await page.request.get(`${PROXY_URL}/health`)).status()).toBe(200);

    await page.goto("/settings");
    await page.getByTestId("test-connection").click();
    await expect(page.getByTestId("model-list")).toBeVisible();
  });

  test("TC-SET-03: updates settings via API", async ({ request }) => {
    // Read current
    const current = await request.get(`${PROXY_URL}/api/settings`);
    const original = await current.json();

    // Update
    const updated = await request.put(`${PROXY_URL}/api/settings`, {
      data: { default_model: "gpt-4o" },
    });
    expect(updated.status()).toBe(200);
    const body = await updated.json();
    expect(body.default_model).toBe("gpt-4o");

    // Restore
    await request.put(`${PROXY_URL}/api/settings`, {
      data: { default_model: original.default_model },
    });
  });

  test("TC-SET-04: rejects invalid URL in settings", async ({ request }) => {
    const res = await request.put(`${PROXY_URL}/api/settings`, {
      data: { copilot_url: "not-a-url" },
    });
    expect(res.status()).toBe(400);
  });
});
