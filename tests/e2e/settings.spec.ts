import { test, expect } from "@playwright/test";

const ADMIN_URL = "http://127.0.0.1:8020"; // Admin API
const CLIENT_URL = "http://127.0.0.1:8022"; // OpenAI-compatible proxy API (unused here)

test.describe("Settings page", () => {
  test("TC-SET-01: reads and displays current settings", async ({ page }) => {
    await expect.poll(async () => (await page.request.get(`${ADMIN_URL}/health`)).status()).toBe(200);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByTestId("settings-url")).toBeVisible();
  });

  test("TC-SET-02: test connection shows model list", async ({ page }) => {
    await expect.poll(async () => (await page.request.get(`${ADMIN_URL}/health`)).status()).toBe(200);

    await page.goto("/settings");
    await page.getByTestId("test-connection").click();
    await expect(page.getByTestId("test-result")).toBeVisible();
  });

  test("TC-SET-03: updates settings via API", async ({ request }) => {
    // Read current
    const current = await request.get(`${ADMIN_URL}/api/admin/settings`);
    const original = await current.json();

    // Update
    const updated = await request.put(`${ADMIN_URL}/api/admin/settings`, {
      data: { default_model: "gpt-4o" },
    });
    expect(updated.status()).toBe(200);
    const body = await updated.json();
    expect(body.default_model).toBe("gpt-4o");

    // Restore
    await request.put(`${ADMIN_URL}/api/admin/settings`, {
      data: { default_model: original.default_model },
    });
  });

  test("TC-SET-04: rejects invalid URL in settings", async ({ request }) => {
    const res = await request.put(`${ADMIN_URL}/api/admin/settings`, {
      data: { copilot_url: "not-a-url" },
    });
    expect(res.status()).toBe(400);
  });
});
